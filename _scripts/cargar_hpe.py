"""
Motor de datos - Hotel Proposal Engine -> Supabase (schema `datos`) para Lexis.

Lee TODOS los .json de hotel-proposal-engine/data/proyectos/ (uno por hotel) y
sube un resumen EDITORIAL a datos.hpe_propuestas: estado, fase de obra, ventana
de prescripcion, marca lider, proxima accion. NUNCA cifras de coste/margen/
viabilidad interna (norma comercial: a JM solo estado+accion, no numeros crudos)
- por eso el extractor solo toca los campos de nivel resumen, nunca
programa_inferido/estrategia_cross_sell en detalle ni ningun precio propio.

Como crece: cuando HPE anada un .json nuevo en data/proyectos/, este script lo
recoge solo en la siguiente carga. No hay lista fija de proyectos.

Requisitos (una vez):
  1. Aplicada la migracion datos_hpe (tabla datos.hpe_propuestas + registrar_tabla).
  2. Concedido el acceso: datos.dar_acceso('hpe_propuestas', '<email>') por
     cada usuario que deba verla (JM, Javi).
  3. Variables de entorno al ejecutar:
       $env:SUPABASE_URL='https://cvtbzxeizdaihyitbphh.supabase.co'
       $env:SUPABASE_SERVICE_KEY='<service_role key>'   # NUNCA en el chat/repo
       $env:HTTPS_PROXY='http://172.22.1.121:8080'; $env:HTTP_PROXY='http://172.22.1.121:8080'

Uso:
    python _scripts\\cargar_hpe.py

Idempotente: borra todo y reinserta (carga completa regenerada).
"""

import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

HPE_PROYECTOS = Path(os.environ.get(
    "HPE_PROYECTOS_DIR",
    r"C:\Users\ES00500148\Desktop\Proyectos IA\01-ibd-mercados-gtm\hotel-proposal-engine\data\proyectos",
))
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()


def _headers():
    return {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
        "Content-Profile": "datos",
        "Accept-Profile": "datos",
        "Prefer": "return=minimal",
    }


def _req(method, url, headers, data=None):
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status


def leer_proyectos():
    """Lee cada .json de la carpeta y extrae SOLO el resumen editorial."""
    filas = []
    for f in sorted(HPE_PROYECTOS.glob("*.json")):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"  [omitido] {f.name}: JSON invalido ({e})")
            continue

        tg = d.get("timing_gate", {}) or {}
        cs = d.get("estrategia_cross_sell", {}) or {}
        complementos = cs.get("complementos") or []

        filas.append({
            "propuesta_id": d.get("id") or f.stem,
            "nombre": d.get("nombre"),
            "ubicacion": d.get("ubicacion"),
            "pais": d.get("pais"),
            "categoria_estrellas": d.get("categoria_estrellas"),
            "tipologia": d.get("tipologia"),
            "llaves": d.get("llaves"),
            "estado": d.get("estado"),
            "apertura": d.get("apertura"),
            "fase_obra": tg.get("fase_obra"),
            "ventana_prescripcion": tg.get("ventana_prescripcion"),
            "prioridad": tg.get("prioridad"),
            "proxima_accion": tg.get("alerta"),
            "marca_lider": cs.get("lider"),
            "marcas_complementarias": ", ".join(complementos) if complementos else None,
            "fuente": d.get("fuente"),
        })
        print(f"  leido: {f.name} -> {d.get('nombre', f.stem)}")
    return filas


def borrar_todo():
    url = f"{SUPABASE_URL}/rest/v1/hpe_propuestas?id=gte.0"
    _req("DELETE", url, _headers())


def insertar(filas):
    if not filas:
        return
    url = f"{SUPABASE_URL}/rest/v1/hpe_propuestas"
    data = json.dumps(filas).encode("utf-8")
    try:
        _req("POST", url, _headers(), data)
    except urllib.error.HTTPError as e:
        det = e.read().decode("utf-8")[:400]
        raise RuntimeError(f"HTTP {e.code}: {det}")


def main():
    if not SUPABASE_URL or not SERVICE_KEY:
        sys.exit("ERROR: define SUPABASE_URL y SUPABASE_SERVICE_KEY en el entorno.")
    if not HPE_PROYECTOS.is_dir():
        sys.exit(f"ERROR: no existe la carpeta {HPE_PROYECTOS}")

    print(f"Leyendo proyectos de {HPE_PROYECTOS} ...")
    filas = leer_proyectos()
    print(f"\n{len(filas)} propuesta(s) encontrada(s).")

    print("Reemplazando datos.hpe_propuestas ...")
    borrar_todo()
    insertar(filas)

    print("\nOK. Cargado en datos.hpe_propuestas.")
    print("Comprueba en Supabase (SQL Editor): select * from datos.hpe_propuestas;")


if __name__ == "__main__":
    main()
