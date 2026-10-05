"""
Carga FICHAS DE REFERENCIA (biografia, contexto de empresa...) en la memoria de Lexis SIN perder detalle.

Por que existe: el pipeline de captura (/api/capture) RESUME cada entrada en 1-2 frases
(`summary`/`content` de 130-300 caracteres) y al responder solo se ensena `summary` al modelo.
Una ficha de 5.000 caracteres quedaba en una frase y se perdian datos concretos (hijos, nieta,
cifras...). Aqui cada ficha se TROCEA en datos sueltos (~300-800 caracteres, con su contexto)
y cada trozo es una memoria con summary = content = el texto literal. Embeddings Voyage como
el resto de Lexis. Idempotente: no duplica (usuario + source_uri). Las memorias-resumen
antiguas de las mismas fichas pasan a status 'superseded' (reversible, no se borra nada).

Entrada: un directorio con `_plan.json` + los .md de cada ficha:
  [{"fichero": "S2_silvestre.md", "para": ["ssegarra@porcelanosa.com"], "seccion": "..."}]
  Prefijo de contexto segun el nombre: S*_silvestre -> biografia de Silvestre (usuario Silvestre);
  S*_empresa / E_* -> contexto de empresa Porcelanosa.

Uso (lee las claves de .env.local; nada por el chat):
    python _scripts\\cargar_fichas.py <directorio_fichas> [--seco]
"""
import json, re, sys, time, urllib.error, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PROXY = {"http": "http://172.22.1.121:8080", "https": "http://172.22.1.121:8080"}
DIMS = 1024
MIN_CAR, MAX_CAR = 280, 800
PROHIBIDO = re.compile(r"(?i)banco de valencia|absuel|absolu|procesad|acusad|audiencia nacional|sentencia")

env = {}
for line in (REPO / ".env.local").read_text(encoding="utf-8").splitlines():
    if "=" in line and not line.lstrip().startswith("#"):
        k, v = line.split("=", 1); env[k.strip()] = v.strip().strip('"')
SB = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/"); SKEY = env["SUPABASE_SERVICE_ROLE_KEY"]; VKEY = env["VOYAGE_API_KEY"]
op = urllib.request.build_opener(urllib.request.ProxyHandler(PROXY))


def http(method, url, headers, body=None, timeout=120):
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
                               headers={"Content-Type": "application/json", **headers})
    try:
        with op.open(r, timeout=timeout) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def sbh(extra=None):
    return {"apikey": SKEY, "Authorization": f"Bearer {SKEY}", **(extra or {})}


# ---------------- troceado ----------------
def limpiar(txt):
    txt = re.sub(r"[-]", "", txt)
    txt = re.sub(r"```\w*\n?", "", txt)                      # vallas de codigo (mermaid)
    return txt.replace("\r", "")


def bloques(texto):
    """Parrafos; las tablas markdown se mantienen juntas (con su cabecera repetida si se parten)."""
    out, cur = [], []
    for ln in texto.split("\n"):
        if ln.strip():
            cur.append(ln.rstrip())
        elif cur:
            out.append(cur); cur = []
    if cur: out.append(cur)
    res = []
    for b in out:
        if b[0].lstrip().startswith("|") and len(b) > 3:     # tabla
            cab, filas = b[:2], b[2:]
            for i in range(0, len(filas), 5):
                res.append("\n".join(cab + filas[i:i + 5]))
        else:
            res.append("\n".join(b))
    return res


def partir_largo(s):
    if len(s) <= MAX_CAR: return [s]
    frases = re.split(r"(?<=[\.\!\?;:])\s+", s)
    out, cur = [], ""
    for f in frases:
        if cur and len(cur) + len(f) + 1 > MAX_CAR:
            out.append(cur); cur = f
        else:
            cur = (cur + " " + f).strip()
    if cur: out.append(cur)
    return out


def trocear(texto):
    piezas = [p for b in bloques(limpiar(texto)) for p in partir_largo(b)]
    out, acum = [], ""
    for p in piezas:
        es_titulo = p.startswith("#")
        if es_titulo and acum:
            out.append(acum); acum = p; continue
        acum = (acum + "\n\n" + p).strip() if acum else p
        if len(acum) >= MIN_CAR and not es_titulo:
            out.append(acum); acum = ""
    if acum:
        if out and len(acum) < 120: out[-1] += "\n\n" + acum
        else: out.append(acum)
    return out


def contexto(fichero, seccion):
    if "_silvestre" in fichero:
        return f"[Ficha de Silvestre Segarra — este usuario ES Silvestre Segarra · {seccion}]"
    if fichero.startswith("S") and "_empresa" in fichero:
        return f"[Contexto de empresa Porcelanosa (perfil del vicepresidente Silvestre Segarra) · {seccion}]"
    return f"[Contexto de empresa Porcelanosa Grupo · {seccion}]"


# ---------------- Voyage ----------------
def embeber(textos):
    vecs, i = [], 0
    while i < len(textos):
        lote, tok = [], 0
        while i < len(textos) and (not lote or tok + len(textos[i]) / 3.2 < 7000):
            lote.append(textos[i]); tok += len(textos[i]) / 3.2; i += 1
        for intento in range(1, 7):
            st, out = http("POST", "https://api.voyageai.com/v1/embeddings", {"Authorization": f"Bearer {VKEY}"},
                           {"input": lote, "model": "voyage-4-lite", "input_type": "document", "output_dimension": DIMS})
            if st == 200: break
            if st == 429 and intento < 6:
                time.sleep(25); continue
            sys.exit(f"Voyage {st}: {out[:200]}")
        d = sorted(json.loads(out)["data"], key=lambda x: x["index"])
        vecs += [x["embedding"] for x in d]
        print(f"    embeddings {len(vecs)}/{len(textos)}", flush=True)
        if i < len(textos): time.sleep(22)               # limite 3 peticiones/min sin tarjeta
    assert all(len(v) == DIMS for v in vecs)
    return vecs


def main():
    d = Path(sys.argv[1]); seco = "--seco" in sys.argv
    plan = json.loads((d / "_plan.json").read_text(encoding="utf-8"))
    st, us = http("GET", f"{SB}/auth/v1/admin/users?per_page=200", sbh())
    uid = {u["email"]: u["id"] for u in json.loads(us)["users"]}

    trabajos = []                                          # (email, uri, texto, seccion, fichero)
    for it in plan:
        raw = (d / it["fichero"]).read_text(encoding="utf-8")
        cuerpo = raw.split("\n\n", 1)[1] if raw.startswith(("FICHA DE", "CONTEXTO DE")) else raw   # quita cabecera vieja
        ctx = contexto(it["fichero"], it["seccion"])
        for n, ch in enumerate(trocear(cuerpo), 1):
            texto = f"{ctx}\n{ch}"
            assert not PROHIBIDO.search(texto), f"contenido judicial en {it['fichero']} #{n}: {PROHIBIDO.search(texto).group(0)}"
            for email in it["para"]:
                trabajos.append((email, f"ficha://{it['fichero']}#{n}", texto, it["seccion"], it["fichero"]))

    unicos = sorted({t[2] for t in trabajos})
    print(f"Trozos totales a cargar: {len(trabajos)} · textos unicos a embeber: {len(unicos)} · tamano medio {sum(len(t) for t in unicos)//max(1,len(unicos))} car.")
    if seco:
        for t in trabajos[:6]: print("\n---", t[0], t[1], "\n" + t[2][:400])
        return

    # ya cargados (no duplicar)
    ya = set()
    for email, u in uid.items():
        st, o = http("GET", f"{SB}/rest/v1/memories?user_id=eq.{u}&source_uri=like.ficha%3A%2F%2F*%23*&select=source_uri&limit=5000", sbh())
        ya |= {(email, r["source_uri"]) for r in json.loads(o)}
    pendientes = [t for t in trabajos if (t[0], t[1]) not in ya]
    print(f"Ya existentes: {len(trabajos) - len(pendientes)} · por cargar: {len(pendientes)}")
    if not pendientes: return

    vec_de = dict(zip(unicos, embeber(sorted({t[2] for t in pendientes}))) ) if False else {}
    por_embeber = sorted({t[2] for t in pendientes})
    vec_de = dict(zip(por_embeber, embeber(por_embeber)))

    ok = 0
    for i in range(0, len(pendientes), 15):
        filas = []
        for email, uri, texto, seccion, fichero in pendientes[i:i + 15]:
            filas.append({"user_id": uid[email], "content": texto, "summary": texto, "raw_excerpt": texto[:500],
                          "source_type": "md", "source_uri": uri,
                          "source_metadata": {"origen": "ficha-referencia", "ficha": fichero, "seccion": seccion, "cargado": "2026-10-05"},
                          "embedding": "[" + ",".join(f"{x:.7g}" for x in vec_de[texto]) + "]", "status": "active"})
        st, out = http("POST", f"{SB}/rest/v1/memories", sbh({"Prefer": "return=minimal"}), filas)
        if st not in (200, 201, 204): sys.exit(f"insert {st}: {out[:300]}")
        ok += len(filas); print(f"    insertados {ok}/{len(pendientes)}", flush=True)

    # las memorias-resumen antiguas de las mismas fichas -> superseded (reversible)
    for email, u in uid.items():
        st, o = http("PATCH", f"{SB}/rest/v1/memories?user_id=eq.{u}&source_uri=like.ficha%3A%2F%2F*&source_uri=not.like.*%23*&status=eq.active",
                     sbh({"Prefer": "return=representation"}), {"status": "superseded"})
        n = len(json.loads(o)) if st == 200 else f"error {st}"
        print(f"  resumenes antiguos -> superseded ({email.split('@')[0]}): {n}")
    print("\nOK.")


if __name__ == "__main__":
    main()
