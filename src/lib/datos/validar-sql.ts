// =====================================================
// Validador de SQL del motor de datos (primera cinta)
//
// Porta validar_sql() de Clavis (services/datamart.py) al dialecto PostgreSQL.
// Es la PRIMERA barrera; la segunda es la función datos.run_query (rol
// datos_ro sin acceso a public/auth). Filosofía: lista blanca estricta, una
// sola sentencia SELECT/WITH, sin comentarios que escondan una segunda.
// =====================================================

export class SqlNoPermitido extends Error {}

// Operaciones que NUNCA pueden aparecer. Escritura/DDL + vectores propios de
// Postgres (lectura de ficheros, sleep, enlaces externos, catálogos).
const PROHIBIDO =
  /\b(insert|update|delete|drop|create|alter|truncate|replace|merge|grant|revoke|comment|call|do|execute|prepare|deallocate|vacuum|analyze|reindex|cluster|lock|listen|notify|unlisten|copy|set|reset|begin|commit|rollback|savepoint|pg_sleep|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|lo_import|lo_export|dblink|dblink_connect|current_setting|set_config|txid_current)\b/i;

// Referencias a esquemas del sistema (fuera del generador de esquema, que corre
// aparte). El SQL del LLM solo debe tocar tablas de datos.*.
const ESQUEMAS_SISTEMA = /\b(pg_catalog|information_schema|pg_temp|auth|storage)\b|\bpg_[a-z_]+\b/i;

const EMPIEZA_OK = /^\s*(select|with)\b/i;

export function validarSql(sql: string): string {
  if (!sql || !sql.trim()) {
    throw new SqlNoPermitido('Consulta vacía');
  }

  let limpio = sql.trim().replace(/;+\s*$/, '').trim();

  // Fuera comentarios (podrían esconder una segunda sentencia).
  limpio = limpio.replace(/--[^\n]*/g, ' ');
  limpio = limpio.replace(/\/\*[\s\S]*?\*\//g, ' ');
  limpio = limpio.trim();

  if (limpio.includes(';')) {
    throw new SqlNoPermitido('Solo se permite una sentencia');
  }
  if (!EMPIEZA_OK.test(limpio)) {
    throw new SqlNoPermitido('Solo se permiten consultas SELECT/WITH');
  }

  const prohibida = limpio.match(PROHIBIDO);
  if (prohibida) {
    throw new SqlNoPermitido(`Operación no permitida: ${prohibida[1]}`);
  }
  if (ESQUEMAS_SISTEMA.test(limpio)) {
    throw new SqlNoPermitido('No se permite consultar esquemas del sistema');
  }

  return limpio;
}
