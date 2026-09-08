"""
Motor de datos de negocio -> Supabase (schema `datos`) para Lexis.

Reemplaza la salida DuckDB de clavis/build_datamart.py: lee los mismos 5 Excel
de silvestre-gpts/data, construye las mismas tablas, y las SUBE a Supabase por
PostgREST (Postgres directo está bloqueado en la red corporativa; HTTPS sí).

Requisitos (una vez):
  1. Aplicada la migración datos_schema (schema `datos` con las 8 tablas + vista).
  2. Aplicada la migración datos_ids (id en las 7 tablas sin PK).
  3. En Dashboard -> Settings -> API -> "Exposed schemas": añadir `datos`.
  4. Variables de entorno al ejecutar:
       $env:SUPABASE_URL='https://cvtbzxeizdaihyitbphh.supabase.co'
       $env:SUPABASE_SERVICE_KEY='<service_role key>'   # NUNCA en el chat/repo
       $env:HTTPS_PROXY='http://172.22.1.121:8080'; $env:HTTP_PROXY='http://172.22.1.121:8080'

Uso:
    python _scripts\cargar_supabase.py

Idempotente: por cada tabla borra todo y reinserta (carga completa regenerada).
La lógica de transformación es COPIA de clavis/apps/api/scripts/build_datamart.py
(no se importa, para no arrastrar duckdb ni ejecutar los build_* por efecto import).
"""

import json
import os
import re
import sys
import time
import unicodedata
import urllib.request
import urllib.error
from pathlib import Path

import pandas as pd

DATA = Path(os.environ.get(
    "SILVESTRE_DATA",
    r"C:\Users\ES00500148\Desktop\Proyectos IA\05-ia-encargos-grupo\silvestre-gpts\data",
))
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
BATCH = 800

MESES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "octubre": 10, "noviembre": 11,
    "diciembre": 12,
}
ALIAS_PAIS = {
    "catar": "qatar", "banglades": "bangladesh", "anguila": "anguilla",
    "antigua/barbuda": "antigua y barbuda",
    "isl.virgenes gb": "islas virgenes (britanicas)",
    "isl.virgenes ee": "islas virgenes (ee.uu.)",
    "sta.c.tenerife": "santa cruz de tenerife",
    "sta.cruz tenerife": "santa cruz de tenerife",
    "estados unidos de america": "estados unidos", "eeuu": "estados unidos",
    "ee.uu.": "estados unidos",
    "reino unido de gran bretana e irlanda del norte": "reino unido",
    "corea del sur": "corea, republica de", "republica de corea": "corea, republica de",
}


def norm(s):
    if s is None:
        return None
    t = unicodedata.normalize("NFD", str(s))
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    t = re.sub(r"\s+", " ", t).strip().lower()
    return ALIAS_PAIS.get(t, t)


def mes_num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)) and not pd.isna(v):
        n = int(v)
        return n if 1 <= n <= 12 else None
    return MESES.get(str(v).strip().lower())


def periodo(anio, mes):
    if anio is None or mes is None or pd.isna(anio) or pd.isna(mes):
        return None
    return int(anio) * 100 + int(mes)


def leer(nombre):
    path = DATA / nombre
    if not path.exists():
        sys.exit(f"FALTA el Excel de origen: {path}")
    return pd.read_excel(path)


def col(df, *candidatos):
    mapa = {norm(c): c for c in df.columns}
    for c in candidatos:
        if norm(c) in mapa:
            return mapa[norm(c)]
    raise KeyError(f"No encuentro ninguna de {candidatos} en {list(df.columns)}")


# ---- Constructores de tabla (copia fiel de build_datamart.py) ----

def tabla_mercado(df):
    c_prov = col(df, "Provincia")
    c_anio = col(df, "año", "Año")
    c_mes = col(df, "Mes 2", "Mes")
    c_pais = col(df, "País")
    c_fuente = col(df, "Fuente")
    c_ccaa = col(df, "Comunidad autonoma", "Comunidad autónoma")
    c_cod = col(df, "Cod")
    es_prov = df[c_prov].notna()
    intl = pd.DataFrame({
        "fuente": df.loc[~es_prov, c_fuente],
        "pais": df.loc[~es_prov, c_pais],
        "pais_norm": df.loc[~es_prov, c_pais].map(norm),
        "anio": df.loc[~es_prov, c_anio].astype("Int64"),
        "mes": df.loc[~es_prov, c_mes],
        "mes_num": df.loc[~es_prov, c_mes].map(mes_num).astype("Int64"),
        "mt2": df.loc[~es_prov, "MT2"].astype(float),
        "eur": df.loc[~es_prov, "EUR"].astype(float),
    })
    intl["periodo"] = [periodo(a, m) for a, m in zip(intl["anio"], intl["mes_num"])]
    prov = pd.DataFrame({
        "fuente": df.loc[es_prov, c_fuente],
        "provincia": df.loc[es_prov, c_prov],
        "provincia_norm": df.loc[es_prov, c_prov].map(norm),
        "cod_ine": df.loc[es_prov, c_cod].astype("Int64"),
        "comunidad": df.loc[es_prov, c_ccaa],
        "anio": df.loc[es_prov, c_anio].astype("Int64"),
        "mt2": df.loc[es_prov, "MT2"].astype(float),
        "eur": df.loc[es_prov, "EUR"].astype(float),
    })
    return intl.reset_index(drop=True), prov.reset_index(drop=True)


def tabla_espana(df):
    return pd.DataFrame({
        "anio": df[col(df, "Año")].astype("Int64"),
        "cod_ine": df[col(df, "CP e INE")].astype("Int64"),
        "provincia": df[col(df, "Provincias")],
        "provincia_norm": df[col(df, "Provincias")].map(norm),
        "ascer_mt2": df[col(df, "Ascer.MT2")].astype(float),
        "ascer_eur": df[col(df, "Ascer.EUR")].astype(float),
        "porcelanosa_mt2": df[col(df, "Porcelanosa.MT2")].astype(float),
        "porcelanosa_eur": df[col(df, "Porcelanosa.EUR")].astype(float),
    })


def tabla_proveedores(df):
    out = pd.DataFrame({
        "acreedor": df[col(df, "Acreedor")].astype("Int64"),
        "empresa": df[col(df, "Empresa")],
        "ramo": df[col(df, "Ramo")],
        "anio": df[col(df, "Año")].astype("Int64"),
        "mes_num": df[col(df, "Mes")].map(mes_num).astype("Int64"),
        "mes": df[col(df, "Nombre mes")].map(lambda s: str(s).capitalize()),
        "valor_eur": df[col(df, "Valor")].astype(float),
    })
    out["periodo"] = [periodo(a, m) for a, m in zip(out["anio"], out["mes_num"])]
    return out


def tabla_sociedad(df):
    out = pd.DataFrame({
        "sociedad": df[col(df, "Sociedad")],
        "org_ventas": df[col(df, "Org.de ventas")],
        "of_ventas": df[col(df, "Of.ventas")],
        "marca": df[col(df, "Marca")],
        "pais_filial": df[col(df, "País")],
        "pais_filial_norm": df[col(df, "País")].map(norm),
        "anio": pd.to_numeric(df[col(df, "Año")], errors="coerce").astype("Int64"),
        "mes": df[col(df, "Mes")],
        "mes_num": df[col(df, "Mes")].map(mes_num).astype("Int64"),
        "mt2": df["MT2"].astype(float),
        "eur": df["EUR"].astype(float),
    })
    out["periodo"] = [periodo(a, m) for a, m in zip(out["anio"], out["mes_num"])]
    return out


def tabla_terceros(df):
    out = pd.DataFrame({
        "sociedad": df[col(df, "Sociedad")],
        "pais": df[col(df, "País")],
        "pais_norm": df[col(df, "País")].map(norm),
        "cliente": df[col(df, "Cliente")],
        "anio": df[col(df, "Año")].astype("Int64"),
        "mes": df[col(df, "Mes")],
        "mes_num": df[col(df, "Mes")].map(mes_num).astype("Int64"),
        "eur": df["EUR"].astype(float),
        "mt2": df["MT2"].astype(float),
    })
    out["periodo"] = [periodo(a, m) for a, m in zip(out["anio"], out["mes_num"])]
    return out


def tabla_cobertura(intl, sociedad, terceros, proveedores, espana, provincial):
    filas = []
    for fuente, sub in intl.groupby("fuente"):
        p = sub["periodo"].dropna()
        filas.append(("mercado_intl", str(fuente), int(p.min()), int(p.max()), len(sub)))
    for nombre, df in [("venta_sociedad", sociedad), ("venta_terceros", terceros), ("proveedores", proveedores)]:
        p = df["periodo"].dropna()
        filas.append((nombre, "-", int(p.min()), int(p.max()), len(df)))
    for nombre, df in [("espana_provincial", espana), ("mercado_provincial", provincial)]:
        a = df["anio"].dropna()
        filas.append((nombre, "-", int(a.min()) * 100, int(a.max()) * 100 + 12, len(df)))
    return pd.DataFrame(filas, columns=["tabla", "fuente", "periodo_min", "periodo_max", "filas"])


def tabla_dim_pais(intl, terceros, sociedad):
    variantes = pd.concat([
        intl[["pais_norm", "pais"]],
        terceros[["pais_norm", "pais"]],
        sociedad[["pais_filial_norm", "pais_filial"]].rename(
            columns={"pais_filial_norm": "pais_norm", "pais_filial": "pais"}),
    ], ignore_index=True).dropna(subset=["pais"]).drop_duplicates()
    variantes["_len"] = variantes["pais"].str.len()
    variantes = variantes.sort_values(["pais_norm", "_len", "pais"], ascending=[True, False, False])
    top = variantes.groupby("pais_norm", as_index=False).first()
    return top[["pais_norm", "pais"]].rename(columns={"pais": "pais_display"})


# ---- Carga a Supabase por PostgREST ----

def _headers(write=True):
    h = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Accept-Profile": "datos",
        "Content-Profile": "datos",
    }
    if write:
        h["Content-Type"] = "application/json"
        h["Prefer"] = "return=minimal"
    return h


def _req(method, url, headers, data=None):
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler())
    with opener.open(req, timeout=120) as resp:
        return resp.getcode()


def borrar_todo(tabla, filtro):
    url = f"{SUPABASE_URL}/rest/v1/{tabla}?{filtro}"
    _req("DELETE", url, _headers())


def insertar(tabla, df):
    records = json.loads(df.to_json(orient="records"))
    url = f"{SUPABASE_URL}/rest/v1/{tabla}"
    for i in range(0, len(records), BATCH):
        chunk = records[i:i + BATCH]
        data = json.dumps(chunk).encode("utf-8")
        for intento in range(1, 4):
            try:
                _req("POST", url, _headers(), data)
                break
            except urllib.error.HTTPError as e:
                det = ""
                try:
                    det = e.read().decode("utf-8")[:200]
                except Exception:
                    pass
                if e.code in (429, 500, 502, 503, 504) and intento < 3:
                    time.sleep(4 * intento)
                    continue
                raise RuntimeError(f"{tabla} lote {i}: HTTP {e.code} {det}")
        print(f"    {tabla}: {min(i + BATCH, len(records))}/{len(records)}")


def main():
    if not SUPABASE_URL or not SERVICE_KEY:
        sys.exit("ERROR: define SUPABASE_URL y SUPABASE_SERVICE_KEY en el entorno.")

    print("Leyendo Excel del hub...")
    intl, provincial = tabla_mercado(leer("Ascer_nac_exp_y_Confindustria.xlsx"))
    espana = tabla_espana(leer("España Ascer y Porcelanosa.xlsx"))
    proveedores = tabla_proveedores(leer("Proveedores.xlsx"))
    sociedad = tabla_sociedad(leer("Venta por sociedad.xlsx"))
    terceros = tabla_terceros(leer("Venta terceros.xlsx"))
    cobertura = tabla_cobertura(intl, sociedad, terceros, proveedores, espana, provincial)
    dim_pais = tabla_dim_pais(intl, terceros, sociedad)

    tablas = [
        ("mercado_intl", intl, "id=gte.0"),
        ("mercado_provincial", provincial, "id=gte.0"),
        ("espana_provincial", espana, "id=gte.0"),
        ("proveedores", proveedores, "id=gte.0"),
        ("venta_sociedad", sociedad, "id=gte.0"),
        ("venta_terceros", terceros, "id=gte.0"),
        ("dim_cobertura", cobertura, "id=gte.0"),
        ("dim_pais", dim_pais, "pais_norm=not.is.null"),
    ]

    for nombre, df, filtro in tablas:
        print(f"\n{nombre}: {len(df):,} filas")
        borrar_todo(nombre, filtro)
        insertar(nombre, df)

    print("\nOK. Datos cargados en el schema `datos` de Supabase.")
    print("Comprueba en Supabase (SQL Editor): select count(*) from datos.mercado_intl;")


if __name__ == "__main__":
    main()
