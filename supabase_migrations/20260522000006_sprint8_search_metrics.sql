-- =====================================================
-- LEXIS — Migración Sprint 8
-- RPCs para búsqueda y timeline con filtros ricos.
-- Sin cambios de schema, solo funciones.
-- =====================================================

-- =====================================================
-- search_memories_filtered: búsqueda semántica con filtros múltiples
-- =====================================================
create or replace function search_memories_filtered(
  p_user_id uuid,
  p_query_embedding vector(1024) default null,
  p_match_count integer default 20,
  p_min_similarity float default 0.0,
  p_project_ids uuid[] default null,
  p_entity_ids uuid[] default null,
  p_source_types text[] default null,
  p_origins text[] default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null
)
returns table (
  id uuid,
  content text,
  summary text,
  source_type text,
  source_metadata jsonb,
  captured_at timestamptz,
  similarity float
)
language plpgsql
stable
as $$
begin
  return query
  select
    m.id,
    m.content,
    m.summary,
    m.source_type,
    m.source_metadata,
    m.captured_at,
    case
      when p_query_embedding is not null then (1 - (m.embedding <=> p_query_embedding))::float
      else 0::float
    end as similarity
  from memories m
  where m.user_id = p_user_id
    and m.status = 'active'
    -- Date range
    and (p_date_from is null or m.captured_at >= p_date_from)
    and (p_date_to is null or m.captured_at <= p_date_to)
    -- Source types
    and (p_source_types is null or m.source_type = any(p_source_types))
    -- Origins (dentro de source_metadata)
    and (p_origins is null or coalesce(m.source_metadata->>'origin', '') = any(p_origins))
    -- Project filter (cualquiera de los proyectos)
    and (
      p_project_ids is null or exists (
        select 1 from memory_projects mp
        where mp.memory_id = m.id and mp.project_id = any(p_project_ids)
      )
    )
    -- Entity filter (cualquiera de las entidades)
    and (
      p_entity_ids is null or exists (
        select 1 from memory_entities me
        where me.memory_id = m.id and me.entity_id = any(p_entity_ids)
      )
    )
    -- Similarity threshold (solo si hay query embedding)
    and (
      p_query_embedding is null
      or (1 - (m.embedding <=> p_query_embedding)) >= p_min_similarity
    )
  order by
    case when p_query_embedding is not null then m.embedding <=> p_query_embedding end asc nulls last,
    m.captured_at desc
  limit p_match_count;
end;
$$;

-- =====================================================
-- user_activity_buckets: serie temporal para dashboard.
-- Agrupa memorias por día/semana/mes según granularidad.
-- =====================================================
create or replace function user_activity_buckets(
  p_user_id uuid,
  p_granularity text default 'day',     -- 'day' | 'week' | 'month'
  p_from timestamptz default null,
  p_to timestamptz default now()
)
returns table (
  bucket timestamptz,
  count integer
)
language sql
stable
as $$
  select
    date_trunc(p_granularity, m.captured_at) as bucket,
    count(*)::integer as count
  from memories m
  where m.user_id = p_user_id
    and m.status = 'active'
    and (p_from is null or m.captured_at >= p_from)
    and m.captured_at <= p_to
  group by bucket
  order by bucket;
$$;

-- =====================================================
-- user_metrics_snapshot: vista única con métricas agregadas
-- para el dashboard. Una sola query para todo lo principal.
-- =====================================================
create or replace function user_metrics_snapshot(p_user_id uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'total_memories', (
      select count(*) from memories
      where user_id = p_user_id and status = 'active'
    ),
    'total_projects', (
      select count(*) from projects where user_id = p_user_id
    ),
    'active_projects', (
      select count(*) from projects
      where user_id = p_user_id and status = 'active'
    ),
    'total_entities', (
      select count(*) from entities where user_id = p_user_id
    ),
    'last_capture', (
      select max(captured_at) from memories
      where user_id = p_user_id and status = 'active'
    ),
    'by_source_type', (
      select jsonb_object_agg(source_type, n)
      from (
        select source_type, count(*)::int as n
        from memories
        where user_id = p_user_id and status = 'active'
        group by source_type
      ) s
    ),
    'memories_last_7d', (
      select count(*) from memories
      where user_id = p_user_id
        and status = 'active'
        and captured_at >= now() - interval '7 days'
    ),
    'memories_last_30d', (
      select count(*) from memories
      where user_id = p_user_id
        and status = 'active'
        and captured_at >= now() - interval '30 days'
    )
  ) into result;
  return result;
end;
$$;
