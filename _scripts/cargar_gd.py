"""
Motor de datos - Global Database (contactos B2B) -> Supabase (schema `datos`).

Lee TODOS los .xlsx de la carpeta de exports de GD (descargados a mano de la
plataforma - no hay API de bulk-export), se queda SOLO con las filas que
traen una persona real (First name relleno) y sube nombre+cargo+empresa+
email directo a datos.gd_contactos. Deduplica entre ficheros (dos exports
del mismo pais pueden ser copias exactas, p.ej. Singapur venia duplicado
en dos nombres de fichero distintos).

RGPD: son datos de contacto PROFESIONAL B2B (decision de Javi 2026-09-22:
JM necesita nombre+cargo+email para poder escribir a alguien de verdad).
No se suben columnas financieras de la empresa ni telefono personal - fuera
de alcance de "a quien contacto".

Carpeta de origen (fija, la misma que lee el reconciliador de gd-harvest):
    ibd-zero/data/market-reference/sources/global-database/*.xlsx

Como crece: cuando descargues un export nuevo de GD, dejalo en esa carpeta
tal cual (cualquier nombre) y la siguiente carga lo recoge solo.

Requisitos (una vez):
  1. Aplicada la migracion datos_gd (tabla datos.gd_contactos + registrar_tabla).
  2. Concedido el acceso: datos.dar_acceso('gd_contactos', '<email>') a JM y a ti.
  3. Instalado openpyxl (python -m pip install openpyxl) si no lo tienes ya.
  4. Variables de entorno al ejecutar:
       $env:SUPABASE_URL='https://cvtbzxeizdaihyitbphh.supabase.co'
       $env:SUPABASE_SERVICE_KEY='<service_role key>'   # NUNCA en el chat/repo
       $env:HTTPS_PROXY='http://172.22.1.121:8080'; $env:HTTP_PROXY='http://172.22.1.121:8080'

Uso:
    python _scripts\\cargar_gd.py

Idempotente: borra todo y reinserta (carga completa regenerada) - tarda unos
minutos por el volumen (~220k contactos).
"""

import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

try:
    import openpyxl
except ImportError:
    sys.exit("ERROR: falta openpyxl. Instala con: python -m pip install openpyxl")

GD_DIR = Path(os.environ.get(
    "GD_EXPORTS_DIR",
    r"C:\Users\ES00500148\Desktop\Proyectos IA\01-ibd-mercados-gtm\ibd-zero\data\market-reference\sources\global-database",
))
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
BATCH = 1500

# Columnas de persona que nos interesan, tal como las nombra GD en el export.
COLS = [
    "Company Name", "Country", "City", "Industry classification",
    "SIC Code", "SIC Activity", "Website",
    "First name", "Second name", "Seniority Level", "Department",
    "Job title", "Linkedin", "Direct line phone number", "Direct email address",
]


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
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status


def leer_contactos():
    """Lee todos los .xlsx, filtra filas con persona real, dedupe entre ficheros."""
    vistos = set()
    filas = []
    ficheros = sorted(p for p in GD_DIR.glob("*.xlsx") if not p.name.startswith("~$"))

    for f in ficheros:
        try:
            wb = openpyxl.load_workbook(f, read_only=True, data_only=True)
        except Exception as e:
            print(f"  [omitido] {f.name}: no se pudo abrir ({e})")
            continue
        ws = wb[wb.sheetnames[0]]
        rows = ws.iter_rows(values_only=True)
        try:
            headers = next(rows)
        except StopIteration:
            continue
        if "First name" not in headers:
            print(f"  [omitido] {f.name}: sin columna 'First name'")
            continue
        idx = {c: headers.index(c) for c in COLS if c in headers}

        en_este_fichero = 0
        for r in rows:
            nombre = r[idx["First name"]] if "First name" in idx else None
            if not nombre:
                continue  # fila sin persona (solo empresa) - fuera de alcance

            def g(col):
                i = idx.get(col)
                return r[i] if i is not None else None

            empresa = g("Company Name")
            apellido = g("Second name")
            cargo = g("Job title")
            email = g("Direct email address")

            clave = (
                str(empresa or "").strip().lower(),
                str(nombre or "").strip().lower(),
                str(apellido or "").strip().lower(),
                str(cargo or "").strip().lower(),
                str(email or "").strip().lower(),
            )
            if clave in vistos:
                continue
            vistos.add(clave)

            filas.append({
                "empresa": empresa,
                "pais": g("Country"),
                "ciudad": g("City"),
                "industria": g("Industry classification"),
                "sic_code": str(g("SIC Code")) if g("SIC Code") is not None else None,
                "sic_actividad": g("SIC Activity"),
                "web": g("Website"),
                "nombre": nombre,
                "apellido": apellido,
                "seniority": g("Seniority Level"),
                "departamento": g("Department"),
                "cargo": cargo,
                "linkedin_persona": g("Linkedin"),
                "telefono_directo": str(g("Direct line phone number")) if g("Direct line phone number") is not None else None,
                "email_directo": email,
                "fuente_fichero": f.name,
            })
            en_este_fichero += 1
        print(f"  {f.name}: {en_este_fichero} contactos nuevos (tras dedupe)")

    return filas


def borrar_todo():
    url = f"{SUPABASE_URL}/rest/v1/gd_contactos?id=gte.0"
    _req("DELETE", url, _headers())


def insertar(filas):
    url = f"{SUPABASE_URL}/rest/v1/gd_contactos"
    for i in range(0, len(filas), BATCH):
        chunk = filas[i:i + BATCH]
        data = json.dumps(chunk).encode("utf-8")
        for intento in range(1, 4):
            try:
                _req("POST", url, _headers(), data)
                break
            except urllib.error.HTTPError as e:
                det = e.read().decode("utf-8")[:300]
                if e.code in (429, 500, 502, 503, 504) and intento < 3:
                    import time
                    time.sleep(4 * intento)
                    continue
                raise RuntimeError(f"lote {i}: HTTP {e.code} {det}")
        print(f"    insertados: {min(i + BATCH, len(filas))}/{len(filas)}")


def main():
    if not SUPABASE_URL or not SERVICE_KEY:
        sys.exit("ERROR: define SUPABASE_URL y SUPABASE_SERVICE_KEY en el entorno.")
    if not GD_DIR.is_dir():
        sys.exit(f"ERROR: no existe la carpeta {GD_DIR}")

    print(f"Leyendo exports de {GD_DIR} ...")
    filas = leer_contactos()
    print(f"\n{len(filas)} contactos únicos (tras dedupe entre ficheros).")

    print("Reemplazando datos.gd_contactos ...")
    borrar_todo()
    insertar(filas)

    print("\nOK. Cargado en datos.gd_contactos.")
    print("Comprueba en Supabase (SQL Editor): select count(*), count(distinct pais) from datos.gd_contactos;")


if __name__ == "__main__":
    main()
