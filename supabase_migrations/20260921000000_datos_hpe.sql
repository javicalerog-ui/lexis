-- =====================================================
-- Módulo HPE (Hotel Proposal Engine) dentro del motor de datos
--
-- Resumen editorial por propuesta hotelera — NUNCA cifras de viabilidad
-- interna (norma ya fijada: a comerciales solo estrellas+acción, nunca
-- scores crudos). Solo lo que ya vive en los JSON de proyecto de HPE:
-- estado, fase de obra, ventana de prescripción, marca líder, próxima acción.
--
-- Fuente real hoy: hotel-proposal-engine/data/proyectos/*.json — SOLO 1
-- propuesta (Meliá White Sands) tiene el JSON completo; Park Royal Cancún
-- solo existe como deck/artefactos (sin JSON), no se carga hasta que exista.
-- El cargador lee TODOS los .json de esa carpeta, así que propuestas nuevas
-- entran solas cuando HPE las estructure.
-- =====================================================

create table if not exists datos.hpe_propuestas (
  id                      bigint generated always as identity primary key,
  propuesta_id            text not null unique,
  nombre                  text,
  ubicacion               text,
  pais                    text,
  categoria_estrellas     integer,
  tipologia               text,
  llaves                  integer,
  estado                  text,
  apertura                text,
  fase_obra               text,
  ventana_prescripcion    text,
  prioridad               text,
  proxima_accion          text,
  marca_lider             text,
  marcas_complementarias  text,
  fuente                  text
);

comment on table datos.hpe_propuestas is
'Resumen editorial de propuestas hoteleras del Hotel Proposal Engine (una fila '
'por proyecto). Da SIEMPRE el estado y la próxima acción, NUNCA cifras de '
'coste/margen/viabilidad interna — esas no están en esta tabla a propósito.';

comment on column datos.hpe_propuestas.ventana_prescripcion is
'ABIERTA = momento de prescribir materiales ahora; CERRADA = ya adjudicado o '
'demasiado pronto. Es la señal más accionable de la tabla.';

comment on column datos.hpe_propuestas.proxima_accion is
'La alerta/siguiente paso sugerido por HPE (p.ej. confirmar con quién y qué).';

-- Alta en el motor: RLS + policy estándar (mismo patrón que las demás tablas).
select datos.registrar_tabla('hpe_propuestas');

-- =====================================================
-- PRUEBA DE HUMO (tras cargar datos, en SQL Editor):
--   select datos.run_query('select nombre, pais, ventana_prescripcion, proxima_accion from hpe_propuestas',
--          (select id from auth.users where email='gpjcalero@gmail.com'));
-- =====================================================
