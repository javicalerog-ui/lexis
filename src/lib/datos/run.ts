// =====================================================
// Ejecuta el SQL del LLM contra el schema `datos` de forma segura.
// Valida (primera cinta) y ejecuta vía la función datos.run_query (segunda
// cinta: rol datos_ro sin acceso a public/auth, read-only, tope 200 filas).
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { validarSql, validarTablasPermitidas, SqlNoPermitido } from './validar-sql';
import { TABLAS_ESQUEMA } from './schema-prompt';

const MAX_FILAS = 200;

// Catálogo completo de nombres consultables (para la cinta de permisos).
const CATALOGO = [...Object.keys(TABLAS_ESQUEMA), 'ventas_pais'];

export type FilaDatos = Record<string, unknown>;

export interface ResultadoDatos {
  ok: boolean;
  rows: FilaDatos[];
  error?: string;
}

/**
 * Valida el SQL y lo ejecuta vía datos.run_query COMO un usuario concreto.
 * `supabase` debe ser el cliente service_role (solo él puede invocar la
 * función; al ser SECURITY DEFINER corre como datos_ro y la RLS por usuario
 * — GUC lexis.datos_user ← userId — decide qué tablas ve).
 * `tablasPermitidas`: las concedidas en datos.acl (cinta 1b, error claro
 * antes de llegar a la base).
 */
export async function ejecutarSqlDatos(
  supabase: SupabaseClient,
  sql: string,
  userId: string,
  tablasPermitidas: string[]
): Promise<ResultadoDatos> {
  let limpio: string;
  try {
    limpio = validarSql(sql);
    validarTablasPermitidas(limpio, tablasPermitidas, CATALOGO);
  } catch (e) {
    const msg = e instanceof SqlNoPermitido ? e.message : String(e);
    return { ok: false, rows: [], error: msg };
  }

  const { data, error } = await supabase
    .schema('datos')
    .rpc('run_query', { p_sql: limpio, p_user: userId });

  if (error) {
    return { ok: false, rows: [], error: error.message };
  }
  const rows = Array.isArray(data) ? (data as FilaDatos[]) : [];
  return { ok: true, rows };
}

/**
 * True si la consulta no encontró nada. OJO al caso silencioso: un SUM/AVG sin
 * filas que casen NO devuelve cero filas, sino UNA fila de NULLs. Sin detectarlo,
 * el redactor lo interpreta como "el dato es cero" y responde algo falso.
 */
export function resultadoVacio(rows: FilaDatos[]): boolean {
  if (!rows.length) return true;
  if (rows.length === 1) {
    return Object.values(rows[0]).every((v) => v === null || v === undefined);
  }
  return false;
}

/** Tabla Markdown compacta para devolver al LLM como contexto. */
export function formatearResultado(rows: FilaDatos[]): string {
  if (resultadoVacio(rows)) {
    return (
      '(SIN RESULTADOS: la consulta no encontró ninguna fila que case con los ' +
      'filtros. Esto NO significa que el dato no exista ni que el negocio sea ' +
      'cero — lo más probable es que el filtro no acertara. Dilo así y ofrece ' +
      'reformular; no expliques por qué no hay datos.)'
    );
  }

  const cols = Object.keys(rows[0]);
  const celda = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') {
      return Number.isInteger(v)
        ? String(v)
        : v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return String(v);
  };

  const lineas = [
    '| ' + cols.join(' | ') + ' |',
    '|' + cols.map(() => '---').join('|') + '|',
    ...rows.map((f) => '| ' + cols.map((c) => celda(f[c])).join(' | ') + ' |'),
  ];
  if (rows.length >= MAX_FILAS) {
    lineas.push(`\n(resultado recortado a ${MAX_FILAS} filas)`);
  }
  return lineas.join('\n');
}
