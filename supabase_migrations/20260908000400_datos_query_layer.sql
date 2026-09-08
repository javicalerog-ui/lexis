-- =====================================================
-- Build 3 · Capa de consulta segura del motor de datos
--
-- El chat de Silvestre traduce su pregunta a un SELECT y lo ejecuta con esta
-- función. GARANTÍA DURA: aunque el validador de texto de la app fallara, el
-- SELECT corre como el rol `datos_ro`, que SOLO tiene lectura sobre el schema
-- `datos` y CERO acceso a public/auth. Un intento de leer public.memories o
-- auth.users falla por privilegios, no por parsing.
--
-- Truco para esquivar el muro de Supabase (no se puede crear/transferir en
-- public): la función vive en `datos` (postgres la puede crear ahí), es
-- SECURITY DEFINER (corre como postgres), y hace `SET LOCAL ROLE datos_ro`
-- ANTES de ejecutar el SQL del LLM → baja privilegios sin transferir owner.
--
-- Requisito para invocarla por rpc: exponer `datos` en Dashboard → Settings →
-- API → Exposed schemas (las tablas siguen sin grants para anon/authenticated).
-- =====================================================

-- 1. Rol de solo lectura (sin login; solo se usa vía SET LOCAL ROLE).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'datos_ro') then
    create role datos_ro nologin;
  end if;
end $$;

-- postgres debe ser miembro de datos_ro para poder SET ROLE a él dentro de la
-- función SECURITY DEFINER.
grant datos_ro to postgres;

grant usage on schema datos to datos_ro;
grant select on all tables in schema datos to datos_ro;
alter default privileges in schema datos grant select on tables to datos_ro;

-- 2. Ejecutor seguro.
create or replace function datos.run_query(p_sql text)
returns jsonb
language plpgsql
security definer
set search_path = datos, pg_temp
as $$
declare
  result jsonb;
  clean  text := btrim(p_sql);
begin
  -- Segunda cinta (la primera es el validador TS). Guard mínimo:
  if lower(clean) !~ '^(select|with)\s' then
    raise exception 'datos.run_query: solo se permiten consultas SELECT/WITH';
  end if;
  if position(';' in clean) > 0 then
    raise exception 'datos.run_query: no se permiten multiples sentencias (;)';
  end if;

  -- Baja de privilegios: a partir de aquí el SQL corre como datos_ro,
  -- que no puede leer public/auth. Todo scoped a la transacción (SET LOCAL).
  set local role datos_ro;
  set local statement_timeout = '5000';
  set local default_transaction_read_only = on;

  execute format(
    'select coalesce(jsonb_agg(t), ''[]''::jsonb) '
    'from (select * from (%s) _q limit 200) t',
    clean
  ) into result;

  return result;
end;
$$;

revoke all on function datos.run_query(text) from public;
grant execute on function datos.run_query(text) to service_role;

comment on function datos.run_query(text) is
'Ejecuta un SELECT/WITH de solo lectura contra el schema datos (como rol '
'datos_ro, sin acceso a public/auth), tope 200 filas y timeout 5s, devuelve '
'jsonb. Barrera dura del motor de datos del LLM; solo service_role la invoca.';

-- =====================================================
-- PRUEBA DE HUMO (tras aplicar, como postgres en SQL Editor):
--   select datos.run_query('select 1 as ok');
--       -> [{"ok":1}]
--   select datos.run_query('select * from public.memories');
--       -> ERROR: permission denied for table memories   (aislamiento OK)
--   select datos.run_query('delete from datos.mercado_intl');
--       -> ERROR: solo se permiten consultas SELECT/WITH
-- =====================================================
