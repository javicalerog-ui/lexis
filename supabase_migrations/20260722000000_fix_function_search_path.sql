-- =====================================================
-- Fix 2026-07-22 · search_path de las funciones que usan operadores de
-- extensiones (pgvector <=>, pg_trgm % / similarity).
--
-- Síntoma: la búsqueda de la app (rol `authenticated`) devolvía HTTP 500,
-- mientras la API v1 (service role) funcionaba. Causa: estas funciones son
-- SECURITY INVOKER y no fijan search_path; el service role tiene `extensions`
-- en su ruta pero `authenticated`/`anon` no, así que `<=>` / `%` no resolvían
-- en tiempo de ejecución. Fijar el search_path de cada función lo resuelve para
-- todos los roles (y silencia el aviso de "function search path mutable").
-- Idempotente y sin impacto en datos.
-- =====================================================

alter function search_memories(vector, integer, float, uuid, uuid, uuid)
  set search_path = public, extensions;

alter function search_memories_filtered(uuid, vector, integer, float, uuid[], uuid[], text[], text[], timestamptz, timestamptz)
  set search_path = public, extensions;

alter function project_name_similarity(uuid, text)
  set search_path = public, extensions;

alter function entity_name_similarity(uuid, text, text)
  set search_path = public, extensions;
