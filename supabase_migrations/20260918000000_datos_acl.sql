-- =====================================================
-- Motor de datos MULTIUSUARIO · ACL tabla × usuario
--
-- Modelo (decidido por Javi 2026-09-18): una matriz de permisos que administra
-- el admin — cada tabla del schema `datos` se concede usuario a usuario.
-- Tres capas:
--   1. datos.acl (tabla, user_id): quién puede consultar qué.
--   2. El prompt del LLM se monta POR USUARIO solo con sus tablas (app).
--   3. CANDADO DURO: RLS sobre las tablas de datos, evaluada contra el GUC
--      `lexis.datos_user` que fija run_query(p_sql, p_user). Aunque el SQL
--      del LLM nombre una tabla vetada, la base no devuelve sus filas.
--      (datos_ro no es owner de las tablas → la RLS le aplica siempre.)
--
-- OJO ORDEN DE DESPLIEGUE: esta migración cambia la firma de run_query a
-- (p_sql, p_user) y borra la antigua. Aplicar y desplegar la app nueva
-- SEGUIDOS: entre ambos pasos el motor responde "sin datos" (ventana corta).
-- =====================================================

-- ---------------------------------------------------------------------------
-- 1. La matriz de permisos
-- ---------------------------------------------------------------------------
create table if not exists datos.acl (
  tabla      text        not null,
  user_id    uuid        not null,
  concedido  timestamptz not null default now(),
  primary key (tabla, user_id)
);
comment on table datos.acl is
'Permisos del motor de datos: qué usuario puede consultar qué tabla. La
administra el admin (Javi). La lee la RLS de cada tabla de datos.';

-- datos_ro tiene que poder leer la ACL para que las policies evalúen.
grant select on datos.acl to datos_ro;
-- La app (service_role) la lee para montar el esquema por usuario, y el admin
-- la gestiona también por API si hace falta.
grant select, insert, update, delete on datos.acl to service_role;

-- ---------------------------------------------------------------------------
-- 2. RLS por tabla, contra el GUC lexis.datos_user
-- ---------------------------------------------------------------------------
-- Tablas "de datos" normales: acceso si hay fila (tabla, usuario) en la ACL.
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
      || 'exists (select 1 from datos.acl a where a.tabla = %L '
      || 'and a.user_id = nullif(current_setting(''lexis.datos_user'', true), '''')::uuid))',
      t, t
    );
  end loop;
end $$;

-- dim_cobertura: filtrado FILA a FILA — cada usuario ve la cobertura solo de
-- sus tablas (la columna `tabla` de la fila se contrasta con su ACL).
alter table datos.dim_cobertura enable row level security;
drop policy if exists acl_select on datos.dim_cobertura;
create policy acl_select on datos.dim_cobertura for select to datos_ro using (
  exists (
    select 1 from datos.acl a
    where a.tabla = dim_cobertura.tabla
      and a.user_id = nullif(current_setting('lexis.datos_user', true), '')::uuid
  )
);

-- dim_pais: tabla de referencia — visible para cualquiera con ALGÚN permiso.
alter table datos.dim_pais enable row level security;
drop policy if exists acl_select on datos.dim_pais;
create policy acl_select on datos.dim_pais for select to datos_ro using (
  exists (
    select 1 from datos.acl a
    where a.user_id = nullif(current_setting('lexis.datos_user', true), '')::uuid
  )
);

-- La vista ventas_pais debe respetar la RLS de QUIEN consulta (datos_ro), no
-- saltársela con los privilegios de su owner (postgres).
alter view datos.ventas_pais set (security_invoker = on);

-- ---------------------------------------------------------------------------
-- 3. run_query v3: lleva la identidad del usuario
-- ---------------------------------------------------------------------------
drop function if exists datos.run_query(text);

create or replace function datos.run_query(p_sql text, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = datos, pg_temp
as $$
declare
  result jsonb;
  clean  text := btrim(p_sql);
begin
  if lower(clean) !~ '^(select|with)\s' then
    raise exception 'datos.run_query: solo se permiten consultas SELECT/WITH';
  end if;
  if position(';' in clean) > 0 then
    raise exception 'datos.run_query: no se permiten multiples sentencias (;)';
  end if;
  if p_user is null then
    raise exception 'datos.run_query: falta el usuario';
  end if;

  -- Identidad para la RLS, scoped a esta transacción.
  perform set_config('lexis.datos_user', p_user::text, true);
  set local statement_timeout = '5000';

  execute format(
    'select coalesce(jsonb_agg(t), ''[]''::jsonb) '
    'from (select * from (%s) _q limit 200) t',
    clean
  ) into result;

  return result;
end;
$$;

-- Mismo modelo que la v2: owner datos_ro (baja de privilegios; SET ROLE está
-- prohibido en security definer), CREATE temporal para poder transferir.
grant create on schema datos to datos_ro;
alter function datos.run_query(text, uuid) owner to datos_ro;
revoke create on schema datos from datos_ro;

revoke all on function datos.run_query(text, uuid) from public;
grant execute on function datos.run_query(text, uuid) to service_role;

comment on function datos.run_query(text, uuid) is
'Ejecuta un SELECT/WITH de solo lectura contra `datos` como rol datos_ro y con
RLS por usuario (GUC lexis.datos_user ← p_user): cada uno solo ve las tablas
que le concede datos.acl. Tope 200 filas, timeout 5s. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 4. Recetas de administración (para Javi, por email)
-- ---------------------------------------------------------------------------
create or replace function datos.dar_acceso(p_tabla text, p_email text)
returns text language plpgsql security definer set search_path = datos, pg_temp
as $$
declare v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(p_email);
  if v_id is null then return 'NO EXISTE el usuario ' || p_email; end if;
  insert into datos.acl (tabla, user_id) values (p_tabla, v_id)
  on conflict do nothing;
  return 'OK: ' || p_email || ' puede consultar ' || p_tabla;
end $$;

create or replace function datos.quitar_acceso(p_tabla text, p_email text)
returns text language plpgsql security definer set search_path = datos, pg_temp
as $$
declare v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(p_email);
  if v_id is null then return 'NO EXISTE el usuario ' || p_email; end if;
  delete from datos.acl where tabla = p_tabla and user_id = v_id;
  return 'OK: ' || p_email || ' ya no consulta ' || p_tabla;
end $$;

-- Alta de una tabla NUEVA en el motor: enciende su RLS + policy estándar.
-- (Llamar tras crear la tabla; luego dar_acceso a quien corresponda.)
create or replace function datos.registrar_tabla(p_tabla text)
returns text language plpgsql security definer set search_path = datos, pg_temp
as $$
begin
  execute format('alter table datos.%I enable row level security', p_tabla);
  execute format('drop policy if exists acl_select on datos.%I', p_tabla);
  execute format(
    'create policy acl_select on datos.%I for select to datos_ro using ('
    || 'exists (select 1 from datos.acl a where a.tabla = %L '
    || 'and a.user_id = nullif(current_setting(''lexis.datos_user'', true), '''')::uuid))',
    p_tabla, p_tabla
  );
  execute format('grant select on datos.%I to datos_ro', p_tabla);
  return 'OK: tabla ' || p_tabla || ' registrada en el motor (sin permisos aún)';
end $$;

revoke all on function datos.dar_acceso(text, text) from public;
revoke all on function datos.quitar_acceso(text, text) from public;
revoke all on function datos.registrar_tabla(text) from public;
grant execute on function datos.dar_acceso(text, text) to service_role;
grant execute on function datos.quitar_acceso(text, text) to service_role;
grant execute on function datos.registrar_tabla(text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Arranque: las tablas actuales, concedidas a todos los usuarios que hoy
--    tienen datos_access o son admin (decisión: "el pozo actual, los tres").
-- ---------------------------------------------------------------------------
insert into datos.acl (tabla, user_id)
select t.tabla, u.id
from (values
  ('mercado_intl'), ('mercado_provincial'), ('espana_provincial'),
  ('proveedores'), ('venta_sociedad'), ('venta_terceros'),
  ('dim_cobertura'), ('dim_pais')
) as t(tabla)
cross join auth.users u
where coalesce(u.raw_app_meta_data->>'datos_access', 'false') = 'true'
   or u.raw_app_meta_data->>'role' = 'admin'
on conflict do nothing;

-- =====================================================
-- PRUEBA DE HUMO (tras aplicar, en SQL Editor):
--   select tabla, count(*) from datos.acl group by tabla order by tabla;
--       -> 8 tablas × nº de usuarios con acceso
--   select datos.run_query('select count(*) as n from mercado_intl',
--          (select id from auth.users where email='gpjcalero@gmail.com'));
--       -> [{"n": <filas>}]
--   select datos.run_query('select count(*) as n from mercado_intl',
--          '00000000-0000-0000-0000-000000000000');
--       -> [{"n":0}]   (usuario sin permisos: RLS lo deja a cero)
-- =====================================================
