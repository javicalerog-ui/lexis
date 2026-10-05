-- =====================================================
-- venta_terceros.es_filial + ventas_pais sin doble conteo (2026-10-05)
--
-- "Venta terceros" replica el Power BI de Silvestre: TODA la venta de las
-- organizaciones de ventas de fabrica (003/004/007/008/042/043) fuera de
-- Espana, incluida la venta a FILIALES PROPIAS (Porcelanosa New York, UK,
-- France...). La vista ventas_pais sumaba esa venta + la venta de la filial
-- a su cliente final (venta_sociedad) -> la misma mercancia contada dos
-- veces (2025: +121 M€; Francia 56,95 M€ en vez de 36,65 M€).
--
-- es_filial lo rellena el cargador (_scripts/cargar_supabase.py) con la lista
-- validada _scripts/clientes_grupo.txt (38 clientes). NO se deduce del nombre.
-- =====================================================

alter table datos.venta_terceros
  add column if not exists es_filial boolean not null default false;

comment on column datos.venta_terceros.es_filial is
'true = el cliente es una EMPRESA DEL GRUPO (filial/tienda propia), no un cliente tercero. '
'Por defecto, "clientes terceros" = es_filial = false. Lo marca el cargador con la lista validada.';

create or replace view datos.ventas_pais
with (security_invoker = on) as
  with todo as (
    select pais_norm, anio, mes, mes_num, periodo,
           'Exportación directa' as canal, eur, mt2
    from datos.venta_terceros
    where not es_filial              -- la venta a filiales ya esta en venta_sociedad
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
'⭐ USA ESTA VISTA para responder "cuanto vendimos en <pais>". Une los DOS canales de venta '
'a CLIENTES EXTERNOS: exportacion directa a clientes terceros (SIN la venta a filiales propias) '
'y venta de las filiales propias a su cliente final. Asi no se cuenta dos veces la mercancia '
'fabrica -> filial -> cliente. Da SIEMPRE el TOTAL y el desglose por canal (Francia 2025: '
'0,3 + 36,4 = 36,65 MEUR). NO la uses para cuota frente a Ascer (eso va contra mercado_intl).';

notify pgrst, 'reload schema';

-- Comprobacion (debe devolver 1 fila con es_filial):
select column_name, data_type from information_schema.columns
where table_schema = 'datos' and table_name = 'venta_terceros' and column_name = 'es_filial';
