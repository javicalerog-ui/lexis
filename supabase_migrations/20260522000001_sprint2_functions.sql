-- =====================================================
-- LEXIS — Migración Sprint 2
-- Funciones RPC para similarity de proyectos y entidades
-- Requiere: pg_trgm (ya habilitada en migración inicial)
-- =====================================================

-- Similarity sobre nombres de proyectos (trigram)
create or replace function project_name_similarity(
  p_user uuid,
  p_query text
)
returns table (
  id uuid,
  slug text,
  name text,
  sim float
)
language sql stable
as $$
  select
    p.id,
    p.slug,
    p.name,
    greatest(
      similarity(p.name, p_query),
      similarity(p.slug, p_query)
    ) as sim
  from projects p
  where
    p.user_id = p_user
    and (
      p.name % p_query
      or p.slug % p_query
    )
  order by sim desc
  limit 5;
$$;

-- Similarity sobre nombres y aliases de entidades
create or replace function entity_name_similarity(
  p_user uuid,
  p_query text,
  p_type text
)
returns table (
  id uuid,
  name text,
  entity_type text,
  sim float
)
language sql stable
as $$
  select
    e.id,
    e.name,
    e.entity_type,
    greatest(
      similarity(e.name, p_query),
      coalesce(
        (
          select max(similarity(a, p_query))
          from unnest(e.aliases) as a
        ),
        0
      )
    ) as sim
  from entities e
  where
    e.user_id = p_user
    and e.entity_type = p_type
    and (
      e.name % p_query
      or exists (
        select 1 from unnest(e.aliases) as a where a % p_query
      )
    )
  order by sim desc
  limit 5;
$$;

-- Búsqueda agregada para una memoria: trae proyectos y entidades enlazadas
create or replace function memory_attachments(p_memory_id uuid)
returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'projects', coalesce(
      (
        select jsonb_agg(jsonb_build_object('id', p.id, 'slug', p.slug, 'name', p.name))
        from memory_projects mp
        join projects p on p.id = mp.project_id
        where mp.memory_id = p_memory_id
      ),
      '[]'::jsonb
    ),
    'entities', coalesce(
      (
        select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'type', e.entity_type))
        from memory_entities me
        join entities e on e.id = me.entity_id
        where me.memory_id = p_memory_id
      ),
      '[]'::jsonb
    )
  );
$$;

-- Trigger: bumpear last_activity_at del proyecto cuando se enlaza una memory
create or replace function bump_project_activity()
returns trigger
language plpgsql
as $$
begin
  update projects
  set last_activity_at = now()
  where id = new.project_id;
  return new;
end;
$$;

drop trigger if exists trg_bump_project_activity on memory_projects;
create trigger trg_bump_project_activity
  after insert on memory_projects
  for each row execute function bump_project_activity();
