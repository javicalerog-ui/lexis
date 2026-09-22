-- =====================================================
-- Módulo Global Database (GD) dentro del motor de datos
--
-- Contactos B2B reales para prospección comercial de JM: nombre, cargo,
-- empresa y email de trabajo directo. Fuente: exports .xlsx descargados a
-- mano de la plataforma Global Database (sin API de bulk-export — alguien
-- tiene que operar la búsqueda y descargar el fichero).
--
-- RGPD: son datos de contacto PROFESIONAL B2B (nombre+cargo+email de
-- trabajo), no datos personales sensibles — decisión de Javi 2026-09-22:
-- JM necesita el dato completo para poder escribir a alguien de verdad.
-- No incluye teléfono personal ni datos financieros de la empresa (fuera
-- de alcance de "a quién contacto").
--
-- Fuente real hoy: ibd-zero/data/market-reference/sources/global-database/
-- (18 ficheros, 220.468 contactos con nombre) — el cargador lee TODOS los
-- .xlsx de esa carpeta dinámicamente, así que descargas nuevas entran solas.
-- =====================================================

create table if not exists datos.gd_contactos (
  id                  bigint generated always as identity primary key,
  empresa             text,
  pais                text,
  ciudad              text,
  industria           text,
  sic_code            text,
  sic_actividad       text,
  web                 text,
  nombre              text,
  apellido            text,
  seniority           text,
  departamento        text,
  cargo               text,
  linkedin_persona    text,
  telefono_directo    text,
  email_directo       text,
  fuente_fichero      text
);

comment on table datos.gd_contactos is
'Contactos B2B reales de Global Database para prospección comercial (JM). '
'Nombre, cargo, empresa, país y email de trabajo directo. NUNCA se filtran '
'a granel para exportar/reenviar fuera del chat: son para responder "¿quién '
'contacto en <país/sector>?", no para volcar listas completas.';

comment on column datos.gd_contactos.email_directo is
'Email de trabajo directo de la persona (no genérico de empresa). Puede '
'estar vacío si GD no lo tenía para ese contacto — decirlo, no inventarlo.';

create index gd_contactos_pais on datos.gd_contactos (pais);
create index gd_contactos_industria on datos.gd_contactos (industria);
create index gd_contactos_cargo on datos.gd_contactos (cargo);

-- Alta en el motor: RLS + policy estándar (mismo patrón que las demás tablas).
select datos.registrar_tabla('gd_contactos');

-- =====================================================
-- PRUEBA DE HUMO (tras cargar datos, en SQL Editor):
--   select count(*), count(distinct pais) from datos.gd_contactos;
--   select datos.run_query('select empresa, nombre, apellido, cargo, email_directo from gd_contactos where pais ilike ''%brazil%'' limit 5',
--          (select id from auth.users where email='jmsegarra@porcelanosagrupo.com'));
-- =====================================================
