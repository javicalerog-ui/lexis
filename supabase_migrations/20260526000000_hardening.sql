-- =====================================================
-- Hardening · 2026-05-26 (post-auditoría)
--
-- Migración aditiva y segura, fruto de la auditoría de la app:
--   1. Índice único anti-duplicados para connectors (external_id).
--   2. Política DELETE faltante en user_settings.
--
-- Es idempotente: se puede re-aplicar sin error.
-- Aplicar en Supabase SQL Editor (o supabase db push) DESPUÉS de las 14
-- migraciones base. La DB ya está poblada/vacía sin duplicados, así que el
-- índice único se crea sin conflicto.
-- =====================================================

-- ---------------------------------------------------------------------------
-- 1. Dedup determinista de memorias ingeridas por connectors.
--
-- El runner de connectors hace "SELECT por external_id, si no existe inserta",
-- lo cual NO es atómico: dos ejecuciones solapadas (cron + "Ejecutar ahora",
-- o dos ticks concurrentes) pueden insertar la misma memoria dos veces.
-- Este índice único parcial lo impide a nivel de BD. El external_id vive en
-- source_metadata->>'external_id' (sólo lo setean los connectors; las capturas
-- manuales no lo tienen → el WHERE parcial las excluye).
-- ---------------------------------------------------------------------------
create unique index if not exists memories_user_external_id_uniq
  on memories (user_id, (source_metadata->>'external_id'))
  where source_metadata->>'external_id' is not null;

-- ---------------------------------------------------------------------------
-- 2. user_settings: faltaba la política DELETE (tenía select/insert/update).
--    Sin ella, RLS bloquea cualquier borrado (no es una fuga, pero impide al
--    usuario resetear sus settings desde el cliente). Por consistencia con el
--    resto de tablas, la añadimos.
-- ---------------------------------------------------------------------------
drop policy if exists "user_settings_delete_own" on user_settings;
create policy "user_settings_delete_own" on user_settings
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- NOTA (revisión futura, NO incluido aquí por riesgo):
-- Las RPC parametrizadas por p_user_id (search_memories_filtered,
-- user_activity_buckets, user_metrics_snapshot, upcoming_events,
-- pending_actions_count, entity_cooccurrence, list_connectors_with_stats)
-- aceptan p_user_id sin contrastarlo con auth.uid(). HOY no es explotable
-- (son SECURITY INVOKER y RLS filtra), pero como defensa en profundidad
-- convendría añadir al inicio de cada una:
--     if p_user_id is distinct from auth.uid() then
--       raise exception 'forbidden';
--     end if;
-- Requiere reescribir cada función con CREATE OR REPLACE preservando su firma
-- y cuerpo exactos; se deja para una migración dedicada y revisada.
-- ---------------------------------------------------------------------------
