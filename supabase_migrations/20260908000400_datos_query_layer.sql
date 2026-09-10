-- =====================================================
-- Build 3 · Capa de consulta segura del motor de datos
--
-- El chat de Silvestre traduce su pregunta a un SELECT y lo ejecuta con esta
-- función. GARANTÍA DURA: aunque el validador de texto de la app fallara, el
-- SELECT corre como el rol `datos_ro`, que SOLO tiene lectura sobre el schema
-- `datos` y CERO acceso a public/auth. Un intento de leer public.memories o
-- auth.users falla por privilegios, no por parsing.
--
-- Diseño (v2, corregido en el go-live 2026-09-10): la función vive en `datos`
-- y es SECURITY DEFINER **propiedad de datos_ro** → el SQL del LLM corre con
-- los privilegios de datos_ro directamente. La v1 hacía `SET LOCAL ROLE
-- datos_ro` dentro de la función, pero Postgres lo PROHÍBE en security
-- definer (42501 "cannot set parameter role within security-definer
-- function"). La transferencia de owner que falló en agosto era en `public`
-- (datos_ro sin CREATE ahí); en el schema `datos` sí se puede: se concede
-- CREATE temporalmente, se transfiere, y se revoca.
--
-- Requisito para invocarla por rpc: exponer `datos` en Dashboard → Settings →
-- API → Exposed schemas (las tablas siguen sin grants para anon/authenticated).
-- =====================================================

-- 1. Rol de solo lectura (sin login; solo existe para ser owner de run_query).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'datos_ro') then
    create role datos_ro nologin;
  end if;
end $$;

-- postgres debe ser miembro de datos_ro para poder transferirle el owner de
-- la función (y para poder seguir editándola después).
grant datos_ro to postgres;

grant usage on schema datos to datos_ro;
grant select on all tables in schema datos to datos_ro;
alter default privileges in schema datos grant select on tables to datos_ro;

-- 2. Ejecutor seguro (owner = datos_ro; ver cabecera).
-- CREATE temporal en datos: requisito de Postgres para poder ser owner de un
-- objeto del schema. Se revoca al final.
grant create on schema datos to datos_ro;

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

  -- La baja de privilegios la da el OWNER de la función (datos_ro, security
  -- definer): el SQL de abajo no puede leer public/auth por privilegios.
  -- (Postgres prohíbe SET ROLE dentro de security definer; por eso owner.)
  set local statement_timeout = '5000';

  execute format(
    'select coalesce(jsonb_agg(t), ''[]''::jsonb) '
    'from (select * from (%s) _q limit 200) t',
    clean
  ) into result;

  return result;
end;
$$;

-- Transferir el owner: el SQL dinámico pasa a correr con los privilegios de
-- datos_ro. Después, datos_ro vuelve a ser solo-lectura (sin CREATE).
alter function datos.run_query(text) owner to datos_ro;
revoke create on schema datos from datos_ro;

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
