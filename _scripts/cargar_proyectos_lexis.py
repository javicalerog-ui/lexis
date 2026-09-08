"""
Carga las fichas de proyectos en Lexis vía la API /api/v1/capture.

- Lee lexis-fiches-proyectos.json (mismo directorio).
- Manda cada ficha como memoria de texto, con external_id -> IDEMPOTENTE:
  si la relanzas, las que ya existen se saltan (no duplica), solo entran las nuevas.
- Reintenta ante fallos temporales (rate-limit de Voyage/OpenRouter, 5xx).
- Respeta el proxy corporativo (HTTPS_PROXY del entorno).

USO (PowerShell), desde 10-lexis-segundo-cerebro:
    $env:LEXIS_TOKEN='pat_xxxxxxxx'          # tu token de Lexis (settings/tokens)
    $env:HTTPS_PROXY='http://172.22.1.121:8080'
    $env:HTTP_PROXY='http://172.22.1.121:8080'
    python _scripts\cargar_proyectos_lexis.py

El token NUNCA se escribe aquí ni se sube al repo: se lee de la variable de entorno.
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

BASE_URL = os.environ.get("LEXIS_BASE_URL", "https://lexis-jade.vercel.app")
TOKEN = os.environ.get("LEXIS_TOKEN", "").strip()
FICHES = Path(__file__).with_name("lexis-fiches-proyectos.json")
WORKSPACE = FICHES.parents[2]   # ...\Desktop\Proyectos IA

DELAY_S = 3.0          # pausa entre fichas (más larga = menos 429 de Voyage)
MAX_RETRIES = 4        # reintentos ante fallo temporal
MAX_CHARS = 3500       # tope de texto por ficha: por encima, el clasificador
                       # devuelve JSON no parseable. El dossier completo sigue
                       # en disco; aquí basta la cabecera + estado como índice.


def contenido(fiche):
    """Devuelve (raw_text, source_type). Si la ficha apunta a un dossier del
    disco y existe, usa su contenido real (auto-actualizable); si no, la ficha
    inline. Los dossieres muy largos se recortan a MAX_CHARS."""
    rel = fiche.get("dossier")
    if rel:
        path = WORKSPACE / rel
        if path.exists():
            txt = path.read_text(encoding="utf-8", errors="replace").strip()
            if len(txt) > MAX_CHARS:
                txt = txt[:MAX_CHARS] + "\n\n[...recortado; dossier completo en disco...]"
            cab = f"# {fiche['title']}\n\n(Ficha de proyecto — fuente: {rel})\n\n"
            return cab + txt, "md"
    return fiche["text"], "text"


def post_capture(fiche):
    raw_text, source_type = contenido(fiche)
    body = json.dumps({
        "source_type": source_type,
        "raw_text": raw_text,
        "source_metadata": {
            "external_id": fiche["external_id"],
            "kind": "project",
            "source": "portfolio-sync",
            "title": fiche["title"],
        },
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{BASE_URL}/api/v1/capture",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        },
    )
    # ProxyHandler lee HTTP(S)_PROXY del entorno; opener explícito por si acaso.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler())
    with opener.open(req, timeout=90) as resp:
        return resp.getcode(), json.loads(resp.read().decode("utf-8"))


def main():
    if not TOKEN:
        sys.exit("ERROR: falta la variable LEXIS_TOKEN. Ponla con tu token de Lexis y reintenta.")
    if not FICHES.exists():
        sys.exit(f"ERROR: no encuentro {FICHES}")

    fiches = json.loads(FICHES.read_text(encoding="utf-8"))
    total = len(fiches)
    creadas = deduplicadas = fallidas = 0
    pendientes = []

    print(f"Cargando {total} fichas en {BASE_URL} ...\n")

    for i, fiche in enumerate(fiches, 1):
        etiqueta = f"[{i:>2}/{total}] {fiche['title'][:48]:<48}"
        ok = False
        for intento in range(1, MAX_RETRIES + 1):
            try:
                code, data = post_capture(fiche)
                if data.get("deduplicated") and data.get("decision") == "duplicate_external_id":
                    print(f"{etiqueta}  = ya existía (saltada)")
                    deduplicadas += 1
                else:
                    print(f"{etiqueta}  + creada ({data.get('decision','ok')})")
                    creadas += 1
                ok = True
                break
            except urllib.error.HTTPError as e:
                detalle = ""
                try:
                    detalle = e.read().decode("utf-8")[:160]
                except Exception:
                    pass
                if e.code in (429, 500, 502, 503, 504) and intento < MAX_RETRIES:
                    espera = 5 * intento
                    print(f"{etiqueta}  . fallo {e.code}, reintento en {espera}s...")
                    time.sleep(espera)
                    continue
                print(f"{etiqueta}  x ERROR {e.code}: {detalle}")
                break
            except Exception as e:
                if intento < MAX_RETRIES:
                    espera = 5 * intento
                    print(f"{etiqueta}  . error red, reintento en {espera}s... ({e})")
                    time.sleep(espera)
                    continue
                print(f"{etiqueta}  x ERROR: {e}")
                break
        if not ok:
            fallidas += 1
            pendientes.append(fiche["external_id"])
        time.sleep(DELAY_S)

    print("\n===== RESUMEN =====")
    print(f"  Creadas:      {creadas}")
    print(f"  Ya existían:  {deduplicadas}")
    print(f"  Fallidas:     {fallidas}")
    if pendientes:
        print("\n  Pendientes (relanza el script y se reintentan solas):")
        for p in pendientes:
            print(f"    - {p}")
    else:
        print("\n  Todo cargado. Puedes relanzarlo cuando quieras: no duplicará.")


if __name__ == "__main__":
    main()
