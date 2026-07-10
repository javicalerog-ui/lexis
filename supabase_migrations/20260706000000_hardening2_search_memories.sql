-- =====================================================
-- Hardening 2 · 2026-07-06 (prerequisito de Acta S0.5)
--
-- search_memories filtraba EXCLUSIVAMENTE por auth.uid(). Bajo el
-- service client (API v1 /capture de Acta, crons) auth.uid() es NULL,
-- así que el clasificador no veía vecinas y nunca deduplicaba.
--
-- Fix: parámetro opcional p_user_id. Con sesión (anon client) sigue
-- funcionando igual (coalesce → auth.uid()); bajo service role se pasa
-- explícito. Defensa en profundidad: la función es SECURITY INVOKER,
-- de modo que un caller anon que pase un p_user_id ajeno sigue filtrado
-- por RLS y no obtiene filas de otro usuario.
--
-- Nota: se hace DROP + CREATE (no OR REPLACE) porque añadir un parámetro
-- crea una sobrecarga y PostgREST fallaría con PGRST203 (ambigüedad)
-- al llamar sin p_user_id. La única llamada en código es
-- src/lib/classifier/decide.ts (actualizada en el mismo commit).
-- =====================================================
--
-- Fix 2026-07-06 (error real al ejecutar: "42704: type vector does not
-- exist"): Supabase instala pgvector en el schema `extensions`, no en
-- `public`. El search_path de esta sesión del SQL Editor no lo incluía
-- (probable tras el ciclo de pausa/reactivación del proyecto free tier),
-- así que `vector(1024)` no resolvía al parsear el DDL de abajo. Las dos
-- líneas siguientes son idempotentes y de alcance solo-sesión: no tocan
-- el search_path en tiempo de ejecución de la función para los callers
-- de PostgREST (que ya funcionaba antes de este hardening).
-- =====================================================

create extension if not exists vector;
set search_path = public, extensions;

drop function if exists search_memories(vector(1024), int, float, uuid, uuid);

create function search_memories(
  query_embedding vector(1024),
  match_count int default 10,
  min_similarity float default 0.4,
  project_filter uuid default null,
  entity_filter uuid default null,
  p_user_id uuid default null
)
returns table (
  id uuid,
  content text,
  summary text,
  source_type text,
  captured_at timestamptz,
  similarity float
)
language sql stable
as $$
  select
    m.id,
    m.content,
    m.summary,
    m.source_type,
    m.captured_at,
    1 - (m.embedding <=> query_embedding) as similarity
  from memories m
  where
    m.user_id = coalesce(p_user_id, auth.uid())
    and m.status = 'active'
    and (1 - (m.embedding <=> query_embedding)) >= min_similarity
    and (
      project_filter is null
      or exists (
        select 1 from memory_projects mp
        where mp.memory_id = m.id and mp.project_id = project_filter
      )
    )
    and (
      entity_filter is null
      or exists (
        select 1 from memory_entities me
        where me.memory_id = m.id and me.entity_id = entity_filter
      )
    )
  order by m.embedding <=> query_embedding
  limit match_count;
$$;
