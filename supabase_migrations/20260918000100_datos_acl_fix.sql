-- =====================================================
-- FIX de la ACL del motor de datos (2026-09-18)
--
-- SÍNTOMA: todas las consultas devolvían 0 filas, incluso para un usuario con
-- las 8 tablas concedidas. La identidad SÍ llegaba (current_setting devolvía
-- el uuid), pero desde dentro `select count(*) from datos.acl` daba 0.
--
-- CAUSA: `datos.acl` tiene RLS y datos_ro no puede leer sus filas. La policy
-- de cada tabla preguntaba «¿existe fila en acl?» directamente, no veía nada
-- y denegaba TODO. (postgres, dueño, sí las ve: de ahí las 16 filas.)
--
-- ARREGLO: la comprobación pasa por funciones SECURITY DEFINER propiedad de
-- postgres, que leen la ACL por encima de su RLS y solo devuelven un boolean.
-- Así las policies dejan de depender del estado de RLS de `acl` — que se
-- queda cerrada a cal y canto (solo la leen estas funciones y service_role).
-- =====================================================

-- ---------------------------------------------------------------------------
-- 1. Comprobadores de permiso (owner postgres, leen la ACL saltándose su RLS)
-- ---------------------------------------------------------------------------
create or replace function datos.tiene_acceso(p_tabla text, p_user uuid)
returns boolean
language sql
security definer
stable
set search_path = datos, pg_temp
as $$
  select exists (
    select 1 from datos.acl a
    where a.tabla = p_tabla and a.user_id = p_user
  );
$$;

create or replace function datos.tiene_algun_acceso(p_user uuid)
returns boolean
language sql
security definer
stable
set search_path = datos, pg_temp
as $$
  select exists (select 1 from datos.acl a where a.user_id = p_user);
$$;

revoke all on function datos.tiene_acceso(text, uuid) from public;
revoke all on function datos.tiene_algun_acceso(uuid) from public;
grant execute on function datos.tiene_acceso(text, uuid) to datos_ro;
grant execute on function datos.tiene_algun_acceso(uuid) to datos_ro;

comment on function datos.tiene_acceso(text, uuid) is
'¿Puede este usuario consultar esta tabla? SECURITY DEFINER para poder leer
datos.acl por encima de su RLS. Solo devuelve boolean: no filtra datos.';

-- ---------------------------------------------------------------------------
-- 2. Rehacer las policies usando los comprobadores
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'mercado_intl', 'mercado_provincial', 'espana_provincial',
    'proveedores', 'venta_sociedad', 'venta_terceros'
  ]
  loop
    execute format('alter table datos.%I enable row level security', t);
    execute format('drop policy if exists acl_select on datos.%I', t);
    execute format(
      'create policy acl_select on datos.%I for select to datos_ro using ('
      || 'datos.tiene_acceso(%L, '
      || 'nullif(current_setting(''lexis.datos_user'', true), '''')::uuid))',
      t, t
    );
  end loop;
end $$;

-- dim_cobertura: fila a fila (cada fila describe una tabla).
alter table datos.dim_cobertura enable row level security;
drop policy if exists acl_select on datos.dim_cobertura;
create policy acl_select on datos.dim_cobertura for select to datos_ro using (
  datos.tiene_acceso(
    dim_cobertura.tabla,
    nullif(current_setting('lexis.datos_user', true), '')::uuid
  )
);

-- dim_pais: referencia; visible para quien tenga ALGÚN permiso.
alter table datos.dim_pais enable row level security;
drop policy if exists acl_select on datos.dim_pais;
create policy acl_select on datos.dim_pais for select to datos_ro using (
  datos.tiene_algun_acceso(
    nullif(current_setting('lexis.datos_user', true), '')::uuid
  )
);

-- ---------------------------------------------------------------------------
-- 3. Y que `registrar_tabla` (alta de tablas nuevas) use el mismo patrón
-- ---------------------------------------------------------------------------
create or replace function datos.registrar_tabla(p_tabla text)
returns text language plpgsql security definer set search_path = datos, pg_temp
as $$
begin
  execute format('alter table datos.%I enable row level security', p_tabla);
  execute format('drop policy if exists acl_select on datos.%I', p_tabla);
  execute format(
    'create policy acl_select on datos.%I for select to datos_ro using ('
    || 'datos.tiene_acceso(%L, '
    || 'nullif(current_setting(''lexis.datos_user'', true), '''')::uuid))',
    p_tabla, p_tabla
  );
  execute format('grant select on datos.%I to datos_ro', p_tabla);
  -- BUG corregido 2026-09-22: faltaba este grant. Sin él, el cargador (que
  -- corre como service_role) recibía 403 al insertar en cualquier tabla dada
  -- de alta DESPUÉS de la migración original (esa sí traía el grant a mano,
  -- pero no es un default-privileges — no se hereda por tablas nuevas).
  execute format(
    'grant select, insert, update, delete, truncate on datos.%I to service_role',
    p_tabla
  );
  return 'OK: tabla ' || p_tabla || ' registrada en el motor (sin permisos de consulta aún)';
end $$;

-- Además: cualquier tabla creada en `datos` a partir de ahora por CREATE TABLE
-- directo (sin pasar por registrar_tabla) también recibe el grant solo, para
-- que este bug no pueda repetirse por otra vía.
alter default privileges in schema datos
  grant select, insert, update, delete, truncate on tables to service_role;

revoke all on function datos.registrar_tabla(text) from public;
grant execute on function datos.registrar_tabla(text) to service_role;

-- =====================================================
-- PRUEBA DE HUMO (en SQL Editor, de una en una):
--   select datos.run_query('select count(*) as n from mercado_intl',
--          (select id from auth.users where email='gpjcalero@gmail.com'));
--       -> [{"n": <miles>}]      <- ahora SÍ
--   select datos.run_query('select count(*) as n from mercado_intl',
--          '00000000-0000-0000-0000-000000000000');
--       -> [{"n":0}]             <- sigue aislando
-- =====================================================
