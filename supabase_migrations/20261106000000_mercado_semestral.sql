-- =====================================================
-- mercado_semestral: Ascer, Porcelanosa y Confindustria por SEMESTRE (2026-11-06)
--
-- Origen: Ascer_nac_exp_y_Confindustria_SEMESTRAL.xlsx. Es el dato BUENO de
-- Italia: la Confindustria de mercado_intl viene de aduanas (Eurostat, infravalora
-- la UE: 2025 ~4.204 M€) y la de esta tabla del boletin oficial (2025 = 4.976 M€).
--
-- Solo filas SIN provincia (exportacion por pais): el detalle provincial ya
-- vive en mercado_provincial / espana_provincial.
-- Pegar COMPLETO en Supabase -> SQL Editor y ejecutar UNA vez. Es repetible.
-- =====================================================

create table if not exists datos.mercado_semestral (
  id         bigint generated always as identity primary key,
  fuente     text,
  pais       text,
  pais_norm  text,
  anio       integer,
  tramo      text,
  cod        text,
  mt2        numeric(18,2),
  eur        numeric(18,2)
);

create index if not exists mercado_semestral_pais_anio on datos.mercado_semestral (pais_norm, anio);
create index if not exists mercado_semestral_fuente    on datos.mercado_semestral (fuente, anio);

comment on table datos.mercado_semestral is
'Exportacion por pais y SEMESTRE (2023 en adelante): fuente Ascer (sector espanol), '
'Porcelanosa (salida de fabrica) y Confindustria (sector italiano, BOLETIN OFICIAL: '
'es el dato bueno de Italia; el de mercado_intl es de aduanas y infravalora la UE). '
'tramo = S1 | S2 | Anual | T3 (jul-sep, solo Confindustria). NUNCA mezclar duraciones: '
'S1 con S1, S2 con S2, Anual con Anual. Ano completo = S1+S2 si existen ambos, o Anual; '
'Anual+S1+S2 del mismo ano nunca se suman; T3 nunca con S2 ni Anual.';

comment on column datos.mercado_semestral.cod is
'Vacio = dato completo. EST = reparto estimado por pais (el total del grupo es exacto): '
'avisar «(est.)». PARCIAL ... = semestre incompleto: decir que meses cubre y no compararlo '
'con uno completo. Ascer 2025: no hay julio; su agosto engloba julio y agosto.';

-- Alta en el motor (RLS + policy + escritura del cargador) y acceso: mismos usuarios que mercado_intl.
select datos.registrar_tabla('mercado_semestral');

-- (sin correos en el repo, que es publico: se copia el acceso de mercado_intl)
insert into datos.acl (tabla, user_id)
select 'mercado_semestral', user_id from datos.acl where tabla = 'mercado_intl'
on conflict do nothing;

notify pgrst, 'reload schema';

-- Comprobacion: debe devolver 3 filas (las mismas personas que ven mercado_intl)
select tabla, count(*) as personas from datos.acl
where tabla in ('mercado_intl', 'mercado_semestral') group by tabla order by tabla;
