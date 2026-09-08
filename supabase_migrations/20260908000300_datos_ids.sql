-- =====================================================
-- Build 2 · IDs para el cargador vía PostgREST
--
-- El cargador (cargar_supabase.py) sube los Excel a las tablas datos.* por
-- HTTPS/PostgREST (Postgres directo está bloqueado en la red corporativa).
-- PostgREST necesita una columna clave para poder borrar/reemplazar filas de
-- forma limpia (DELETE exige filtro; sin PK no hay filtro cómodo).
--
-- Añadimos un id identity a las 7 tablas de datos que no tenían PK.
-- dim_pais ya tiene PK (pais_norm), no se toca.
--
-- Tras aplicar: en Dashboard → Settings → API → "Exposed schemas", añadir
-- `datos` para que el service_role pueda escribir por REST (las tablas siguen
-- sin acceso para anon/authenticated: no tienen grants).
-- =====================================================

alter table datos.mercado_intl        add column if not exists id bigint generated always as identity primary key;
alter table datos.mercado_provincial  add column if not exists id bigint generated always as identity primary key;
alter table datos.espana_provincial   add column if not exists id bigint generated always as identity primary key;
alter table datos.proveedores         add column if not exists id bigint generated always as identity primary key;
alter table datos.venta_sociedad      add column if not exists id bigint generated always as identity primary key;
alter table datos.venta_terceros      add column if not exists id bigint generated always as identity primary key;
alter table datos.dim_cobertura       add column if not exists id bigint generated always as identity primary key;
