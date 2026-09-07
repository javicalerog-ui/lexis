-- =====================================================
-- Build 2 · Motor de datos de negocio portado de Clavis (Fase 2 del plan)
--
-- Crea el schema `datos` con las 8 tablas + la vista ventas_pais que
-- Clavis tenía en DuckDB (clavis-datos.duckdb, ~119.750 filas). Traducido
-- 1:1 de clavis/apps/api/scripts/build_datamart.py, incluidos los COMMENT
-- ON literales — son la semántica anti-mentira que el LLM lee del esquema
-- (perímetros de cuota, huecos de fuente, canal de venta). Sin ellos, el
-- motor da cifras plausibles y falsas (p.ej. cuota 6,6% en vez de 13,6%).
--
-- AISLAMIENTO (fix del riesgo #1 del plan): estas tablas NO llevan RLS por
-- user_id (son datos de EMPRESA, no memorias personales). La protección es
-- que el schema `datos` NO se expone por PostgREST y NO se concede acceso a
-- anon/authenticated: solo service_role y (migración siguiente) un rol de
-- solo lectura dedicado para la ejecución del SQL del LLM. El acceso de
-- Silvestre/Javi-admin a estos datos se controla en la capa de aplicación
-- (rama 'datos' del chat), nunca por el rol anon/authenticated.
--
-- IMPORTANTE tras aplicar: verificar en Dashboard → Settings → API que el
-- schema `datos` NO está en "Exposed schemas" (por defecto no lo estará).
--
-- Tipos: NUMERIC(18,2) para eur/mt2 (evita round() sobre double de Postgres,
-- riesgo #3). periodo/anio/mes_num/cod_ine como INTEGER; acreedor BIGINT.
-- =====================================================

create schema if not exists datos;

-- Blindaje: nada de acceso por defecto a los roles del cliente.
revoke all on schema datos from anon, authenticated;
grant usage on schema datos to service_role;

-- --------------------------------------------------------------------------
-- 1. mercado_intl — exportación mensual por país y fuente
-- --------------------------------------------------------------------------
create table datos.mercado_intl (
  fuente     text,
  pais       text,
  pais_norm  text,
  anio       integer,
  mes        text,
  mes_num    integer,
  mt2        numeric(18,2),
  eur        numeric(18,2),
  periodo    integer
);

comment on table datos.mercado_intl is
'Exportacion mensual por pais y fuente, en euros y metros cuadrados. '
'fuente=''Ascer'' = exportacion TOTAL del sector ceramico espanol (incluye '
'a Porcelanosa dentro); ''Confindustria'' = exportacion total del sector '
'ceramico italiano (el gran competidor); ''Porcelanosa'' = exportacion '
'DIRECTA del grupo a clientes terceros. '
'*** PERIMETRO - CRITICO: la serie ''Porcelanosa'' NO incluye lo que '
'venden las filiales propias (Porven EE.UU., Reino Unido, Francia, '
'Mexico...), que esta en venta_sociedad y suma un importe similar. '
'Verificado: mercado_intl(Porcelanosa) y venta_terceros son el mismo '
'universo (difieren <0,5%). Por tanto una cuota calculada solo con esta '
'tabla INFRAESTIMA a la mitad: en 2025 da 6,6% cuando sumando filiales '
'ronda el 13,6%. Al dar una cuota, SIEMPRE advertir que la cifra corta '
'es solo exportacion directa, o sumar venta_sociedad y decirlo. *** '
'Precio medio (eur/mt2) SI es comparable entre las tres fuentes: '
'verificado que la serie Porcelanosa es 99% ceramica (Ceramica 78%, '
'XLight 11%, XTone 10%); sanitarios y muebles son ~1%. '
'OJO tambien: cada fuente acaba en un mes distinto, consultar '
'dim_cobertura antes de comparar acumulados. '
'HUECO CONOCIDO: en Ascer NO existe julio de 2025 — la fila de agosto '
'de 2025 engloba julio+agosto juntos (la fuente no publico el corte '
'intermedio). Advertirlo en cualquier analisis mensual o interanual '
'que toque jul/ago de 2025.';

-- --------------------------------------------------------------------------
-- 2. mercado_provincial — venta anual por provincia española
-- --------------------------------------------------------------------------
create table datos.mercado_provincial (
  fuente          text,
  provincia       text,
  provincia_norm  text,
  cod_ine         integer,
  comunidad       text,
  anio            integer,
  mt2             numeric(18,2),
  eur             numeric(18,2)
);

comment on table datos.mercado_provincial is
'Venta ANUAL por provincia espanola (fuente Ascer = sector, '
'Porcelanosa = propia). No tiene detalle mensual.';

-- --------------------------------------------------------------------------
-- 3. espana_provincial — mercado nacional por provincia y año
-- --------------------------------------------------------------------------
create table datos.espana_provincial (
  anio             integer,
  cod_ine          integer,
  provincia        text,
  provincia_norm   text,
  ascer_mt2        numeric(18,2),
  ascer_eur        numeric(18,2),
  porcelanosa_mt2  numeric(18,2),
  porcelanosa_eur  numeric(18,2)
);

comment on table datos.espana_provincial is
'Mercado nacional ESPANOL por provincia y ano (52 provincias x 2022-2026), '
'con Ascer y Porcelanosa en columnas paralelas: permite cuota provincial '
'directa. Solo dato ANUAL: no hay mes, no calcular YTD. '
'HUECOS REALES DE LA FUENTE (son ''sin dato'', NUNCA cero): 2022 no tiene '
'ascer_mt2 (el informe de ese ano solo publico euros); 2026 no tiene '
'ninguna columna de Ascer (la encuesta provincial aun no esta publicada) '
'y Porcelanosa solo cubre 48 de las 52 provincias por ser ano en curso. '
'Ademas ascer_eur de 2022 esta redondeado a miles: no comparar '
'variaciones finas de 2022 contra 2023.';

-- --------------------------------------------------------------------------
-- 4. proveedores — compras por acreedor, ramo y mes
-- --------------------------------------------------------------------------
create table datos.proveedores (
  acreedor   bigint,
  empresa    text,
  ramo       text,
  anio       integer,
  mes_num    integer,
  mes        text,
  valor_eur  numeric(18,2),
  periodo    integer
);

comment on table datos.proveedores is
'COMPRAS a proveedores por acreedor, ramo y mes (2017 en adelante). '
'Es gasto, no venta: nunca sumar con las tablas de venta. Sin pais ni '
'marca: solo cruza por tiempo. ''empresa'' es razon social real.';

-- --------------------------------------------------------------------------
-- 5. venta_sociedad — venta propia por filial, oficina y marca
-- --------------------------------------------------------------------------
create table datos.venta_sociedad (
  sociedad          text,
  org_ventas        text,
  of_ventas         text,
  marca             text,
  pais_filial       text,
  pais_filial_norm  text,
  anio              integer,
  mes               text,
  mes_num           integer,
  mt2               numeric(18,2),
  eur               numeric(18,2),
  periodo           integer
);

comment on table datos.venta_sociedad is
'Venta propia por filial, organizacion, oficina y marca. ATENCION: '
'pais_filial es el domicilio de la filial, NO el destino de la venta. '
'marca solo tiene Porcelanosa, Xlight y Xtone (es el centro de '
'beneficio, no el catalogo completo de marcas del grupo).';

-- --------------------------------------------------------------------------
-- 6. venta_terceros — exportación a clientes terceros por país y cliente
-- --------------------------------------------------------------------------
create table datos.venta_terceros (
  sociedad   text,
  pais       text,
  pais_norm  text,
  cliente    text,
  anio       integer,
  mes        text,
  mes_num    integer,
  eur        numeric(18,2),
  mt2        numeric(18,2),
  periodo    integer
);

comment on table datos.venta_terceros is
'Exportacion a clientes terceros por pais y cliente (2022 en adelante). '
'Excluye Espana: el mercado nacional NO esta aqui. ''cliente'' es nombre '
'real de cliente. Sirve para rankings, concentracion de cartera y altas/'
'bajas. OJO: la sociedad ''Exp Urbatek Ceramics'' solo existe en 2022 y '
'''Nacional Porcelanosa'' tiene una unica fila residual — no son series '
'continuas, cuidado al comparar anos por sociedad. No hay marca ni '
'oficina en esta tabla.';

-- --------------------------------------------------------------------------
-- 7. dim_cobertura — hasta qué periodo llega cada serie
-- --------------------------------------------------------------------------
create table datos.dim_cobertura (
  tabla        text,
  fuente       text,
  periodo_min  integer,
  periodo_max  integer,
  filas        integer
);

comment on table datos.dim_cobertura is
'Hasta que periodo (AAAAMM) llega cada serie. Consultar SIEMPRE antes '
'de comparar acumulados entre fuentes distintas.';

-- --------------------------------------------------------------------------
-- 8. dim_pais — nombre canónico de cada país
-- --------------------------------------------------------------------------
create table datos.dim_pais (
  pais_norm     text primary key,
  pais_display  text
);

comment on table datos.dim_pais is
'Nombre canonico de cada pais (pais_norm -> pais_display). Usalo cuando '
'agregues por pais uniendo tablas distintas: sin el, Estados Unidos '
'aparece dos veces (una como EE.UU.) y el total del mercado sale partido.';

-- --------------------------------------------------------------------------
-- Vista canónica de ventas por país (los DOS canales unificados)
-- --------------------------------------------------------------------------
create view datos.ventas_pais as
  with todo as (
    select pais_norm, anio, mes, mes_num, periodo,
           'Exportación directa' as canal, eur, mt2
    from datos.venta_terceros
    union all
    select pais_filial_norm as pais_norm,
           anio, mes, mes_num, periodo,
           'Filial propia' as canal, eur, mt2
    from datos.venta_sociedad
  )
  select coalesce(d.pais_display, t.pais_norm) as pais,
         t.pais_norm, t.anio, t.mes, t.mes_num, t.periodo,
         t.canal, t.eur, t.mt2
  from todo t
  left join datos.dim_pais d on d.pais_norm = t.pais_norm;

comment on view datos.ventas_pais is
'⭐ USA ESTA VISTA para responder "cuanto vendimos en <pais>". Une los '
'DOS canales de venta del grupo: exportacion directa a clientes terceros '
'y venta de las filiales propias (EE.UU., Reino Unido, Francia, Mexico...). '
'Da SIEMPRE el TOTAL como cifra principal y el desglose por canal debajo: '
'en Francia 2025 son 20,6 + 36,4 = 56,9 MEUR, y dar solo una de las dos '
'partes confunde. Columna canal = Exportacion directa | Filial propia. '
'Ojo: NO la uses para calcular cuota frente a Ascer (esa se compara '
'contra mercado_intl, que mide exportacion desde Espana).';

-- --------------------------------------------------------------------------
-- Índices para las consultas típicas del chat
-- --------------------------------------------------------------------------
create index mercado_intl_pais_anio  on datos.mercado_intl (pais_norm, anio);
create index mercado_intl_periodo    on datos.mercado_intl (periodo);
create index mercado_intl_fuente     on datos.mercado_intl (fuente);
create index venta_terceros_pais     on datos.venta_terceros (pais_norm, anio);
create index venta_terceros_periodo  on datos.venta_terceros (periodo);
create index venta_sociedad_pais     on datos.venta_sociedad (pais_filial_norm, anio);
create index venta_sociedad_periodo  on datos.venta_sociedad (periodo);
create index proveedores_periodo     on datos.proveedores (periodo);
create index proveedores_ramo        on datos.proveedores (ramo);
create index espana_provincial_anio  on datos.espana_provincial (anio, cod_ine);

-- --------------------------------------------------------------------------
-- Grants: escritura solo service_role (el cargador local usará esa clave).
-- La lectura para el chat irá por un rol dedicado en la migración siguiente
-- (20260908000200_datos_ro_role.sql), NO por anon/authenticated.
-- --------------------------------------------------------------------------
grant select, insert, update, delete, truncate
  on all tables in schema datos to service_role;
-- (las vistas heredan el select de sus tablas base para service_role)
