-- ============================================================
-- LEXIS · esquema completo (16 migraciones concatenadas en orden)
-- Generado 2026-07-16 para arrancar Lexis en un proyecto Supabase
-- NUEVO Y VACIO. Pegar entero en el SQL Editor y Run.
-- Requiere un proyecto sin tablas previas (ver query de verificacion).
-- ============================================================
create extension if not exists vector;
create extension if not exists pg_trgm;
create extension if not exists "uuid-ossp";
set search_path = public, extensions;


-- ============================================================
-- [1/16] 20260522000000_initial_schema.sql
-- ============================================================
-- =====================================================
-- LEXIS â€” MigraciÃ³n inicial
-- Sprint 0: schema base, pgvector, RLS
-- Embeddings: voyage-4-lite (1024 dims, Matryoshka)
-- =====================================================

-- Extensiones requeridas
create extension if not exists vector;
create extension if not exists pg_trgm;
create extension if not exists "uuid-ossp";

-- =====================================================
-- TABLA: memories
-- Unidad atÃ³mica de captura. Toda entrada del sistema
-- (texto, voz transcrita, imagen captioneada, PDF
-- parseado, fila relevante de XLSX) se persiste aquÃ­.
-- =====================================================
create table memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,

  -- Contenido
  content text not null,                  -- texto original o caption generado
  summary text,                            -- resumen MD generado por LLM
  raw_excerpt text,                        -- fragmento literal sin procesar (auditorÃ­a)

  -- Origen
  source_type text not null,               -- 'text' | 'voice' | 'image' | 'pdf' | 'xlsx' | 'md' | 'url'
  source_uri text,                         -- ruta en Supabase Storage si aplica
  source_metadata jsonb default '{}'::jsonb,  -- exif, autor PDF, hoja XLSX, etc.

  -- Embedding semÃ¡ntico
  embedding vector(1024),                  -- voyage-4-lite

  -- Temporalidad
  captured_at timestamptz default now(),   -- cuÃ¡ndo ocurriÃ³ el hecho real
  ingested_at timestamptz default now(),   -- cuÃ¡ndo entrÃ³ en Lexis

  -- Estado
  status text default 'active'             -- 'active' | 'superseded' | 'archived'
);

create index memories_embedding_hnsw on memories
  using hnsw (embedding vector_cosine_ops);

create index memories_content_trgm on memories
  using gin (content gin_trgm_ops);

create index memories_user_captured_at on memories (user_id, captured_at desc);
create index memories_source_type on memories (source_type);

-- =====================================================
-- TABLA: projects
-- Entidad agregada con estado vivo. El asistente
-- proactivo (use case #1) opera sobre esta tabla.
-- =====================================================
create table projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,

  name text not null,                      -- "Clavis", "Gaiata 1", "IntelHub"
  slug text not null,
  description text,

  status text default 'active',            -- 'active' | 'paused' | 'archived' | 'done'

  -- Estado agregado vivo
  rolling_summary text,                    -- estado actual, regenerado periÃ³dicamente
  rolling_next_steps text,                 -- propuestas activas del asistente
  rolling_summary_updated_at timestamptz,

  -- BÃºsqueda semÃ¡ntica sobre proyectos
  embedding vector(1024),

  last_activity_at timestamptz,
  created_at timestamptz default now(),

  unique (user_id, slug)
);

create index projects_embedding_hnsw on projects
  using hnsw (embedding vector_cosine_ops);

create index projects_user_status on projects (user_id, status);

-- =====================================================
-- TABLA: entities
-- Personas, organizaciones, lugares, conceptos
-- recurrentes. Base para use case #3 (fichas).
-- =====================================================
create table entities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,

  name text not null,                      -- "Alfonso MuÃ±oz"
  entity_type text not null,               -- 'person' | 'org' | 'place' | 'concept' | 'product'
  aliases text[] default '{}',             -- ["Alfonso", "AM"]

  attributes jsonb default '{}'::jsonb,    -- {rol: "jefe IBD", empresa: "Porcelanosa"}
  rolling_summary text,

  embedding vector(1024),

  created_at timestamptz default now(),
  last_seen_at timestamptz,

  unique (user_id, name, entity_type)
);

create index entities_embedding_hnsw on entities
  using hnsw (embedding vector_cosine_ops);

create index entities_user_type on entities (user_id, entity_type);
create index entities_aliases_gin on entities using gin (aliases);

-- =====================================================
-- RELACIONES many-to-many
-- =====================================================
create table memory_projects (
  memory_id uuid references memories(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  relevance float default 1.0,             -- 0-1, asignado por clasificador
  assigned_by text default 'classifier',   -- 'classifier' | 'manual'
  created_at timestamptz default now(),
  primary key (memory_id, project_id)
);

create index memory_projects_project on memory_projects (project_id);

create table memory_entities (
  memory_id uuid references memories(id) on delete cascade,
  entity_id uuid references entities(id) on delete cascade,
  role text,                               -- 'mentioned' | 'subject' | 'author' | 'attendee'
  created_at timestamptz default now(),
  primary key (memory_id, entity_id)
);

create index memory_entities_entity on memory_entities (entity_id);

-- =====================================================
-- TABLA: ingestion_log
-- AuditorÃ­a del clasificador (Sprint 2). Decide si
-- una entrada es nueva, modifica una existente o es
-- redundante. Mantiene trazabilidad.
-- =====================================================
create table ingestion_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,

  source_uri text,
  input_excerpt text,                      -- primeros 500 chars de lo entrado

  status text not null,                    -- 'pending' | 'processing' | 'completed' | 'failed'
  decision text,                           -- 'new' | 'modification' | 'redundant' | 'unclear'
  decision_confidence float,
  decision_model text,                     -- 'gemini-flash' | 'sonnet-4.6' (escalaciÃ³n)

  resulting_memory_id uuid references memories(id) on delete set null,
  modified_memory_id uuid references memories(id) on delete set null,

  error_message text,
  processing_ms integer,

  created_at timestamptz default now()
);

create index ingestion_log_user_created on ingestion_log (user_id, created_at desc);
create index ingestion_log_status on ingestion_log (status) where status != 'completed';

-- =====================================================
-- ROW LEVEL SECURITY
-- Aunque el sistema es mono-usuario, habilitamos RLS
-- desde el dÃ­a 1 para soberanÃ­a y portabilidad futura.
-- (Anti-patrÃ³n del podcast: confiar la seguridad al
-- prompt en vez de a la DB.)
-- =====================================================
alter table memories enable row level security;
alter table projects enable row level security;
alter table entities enable row level security;
alter table memory_projects enable row level security;
alter table memory_entities enable row level security;
alter table ingestion_log enable row level security;

create policy "own_memories" on memories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own_projects" on projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own_entities" on entities
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own_memory_projects" on memory_projects
  for all using (
    exists (select 1 from memories m where m.id = memory_id and m.user_id = auth.uid())
  );

create policy "own_memory_entities" on memory_entities
  for all using (
    exists (select 1 from memories m where m.id = memory_id and m.user_id = auth.uid())
  );

create policy "own_ingestion_log" on ingestion_log
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =====================================================
-- FUNCIÃ“N RPC: bÃºsqueda semÃ¡ntica
-- Llamada desde el cliente para sprint 1 (use case #2).
-- =====================================================
create or replace function search_memories(
  query_embedding vector(1024),
  match_count int default 10,
  min_similarity float default 0.4,
  project_filter uuid default null,
  entity_filter uuid default null
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
    m.user_id = auth.uid()
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


-- ============================================================
-- [2/16] 20260522000001_sprint2_functions.sql
-- ============================================================
-- =====================================================
-- LEXIS â€” MigraciÃ³n Sprint 2
-- Funciones RPC para similarity de proyectos y entidades
-- Requiere: pg_trgm (ya habilitada en migraciÃ³n inicial)
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

-- BÃºsqueda agregada para una memoria: trae proyectos y entidades enlazadas
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


-- ============================================================
-- [3/16] 20260522000002_sprint3_feed_cache.sql
-- ============================================================
-- =====================================================
-- LEXIS â€” MigraciÃ³n Sprint 3
-- Cache del feed proactivo.
-- =====================================================

create table if not exists feed_cache (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  generated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  model_used text,
  projects_considered integer
);

create index if not exists feed_cache_expires_idx on feed_cache (expires_at);

alter table feed_cache enable row level security;

create policy "own_feed_cache" on feed_cache
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- FunciÃ³n para limpiar cache expirado (puede llamarse vÃ­a cron)
create or replace function cleanup_expired_feed_cache()
returns integer
language sql
as $$
  with deleted as (
    delete from feed_cache where expires_at < now() returning user_id
  )
  select count(*)::integer from deleted;
$$;


-- ============================================================
-- [4/16] 20260522000003_sprint4_interviews.sql
-- ============================================================
-- =====================================================
-- LEXIS â€” MigraciÃ³n Sprint 4
-- Sesiones de entrevista para vaciado histÃ³rico.
-- =====================================================

-- Tipos de foco
do $$ begin
  create type interview_focus_type as enum ('open', 'project', 'entity');
exception when duplicate_object then null; end $$;

do $$ begin
  create type interview_status as enum ('active', 'paused', 'completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type interview_role as enum ('assistant', 'user', 'system');
exception when duplicate_object then null; end $$;

-- Sesiones
create table if not exists interview_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,

  status interview_status not null default 'active',
  focus_type interview_focus_type not null default 'open',
  focus_project_id uuid references projects(id) on delete set null,
  focus_entity_id uuid references entities(id) on delete set null,

  title text,                                  -- generado a posteriori, resumen 1 lÃ­nea
  questions_asked integer not null default 0,
  memories_generated integer not null default 0,
  saturation_signal float,                     -- 0-1, segÃºn el LLM, cuÃ¡n saturada estÃ¡ la sesiÃ³n

  created_at timestamptz default now(),
  last_message_at timestamptz default now(),
  completed_at timestamptz
);

create index if not exists interview_sessions_user_status_idx
  on interview_sessions (user_id, status, last_message_at desc);

-- Mensajes de la sesiÃ³n (conversaciÃ³n entrevistador â†” usuario)
create table if not exists interview_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references interview_sessions(id) on delete cascade not null,

  role interview_role not null,
  content text not null,

  -- Cuando el user responde, la respuesta se ingesta como memoria.
  -- Guardamos la referencia para trazabilidad.
  memory_id uuid references memories(id) on delete set null,

  -- Solo para mensajes del assistant
  reasoning text,                              -- por quÃ© esta pregunta (debug)
  topic_shift boolean,

  created_at timestamptz default now()
);

create index if not exists interview_messages_session_idx
  on interview_messages (session_id, created_at);

-- RLS
alter table interview_sessions enable row level security;
alter table interview_messages enable row level security;

create policy "own_interview_sessions" on interview_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own_interview_messages" on interview_messages
  for all using (
    exists (
      select 1 from interview_sessions s
      where s.id = session_id and s.user_id = auth.uid()
    )
  );


-- ============================================================
-- [5/16] 20260522000004_sprint6_entity_summaries.sql
-- ============================================================
-- =====================================================
-- LEXIS â€” MigraciÃ³n Sprint 6
-- Fichas de entidad enriquecidas:
--   - rolling_summary ya existe; aÃ±adimos updated_at y stale flag
--   - key_facts: atributos canÃ³nicos destilados (rol, organizaciÃ³n, etc.)
--   - interaction_count: cuÃ¡ntas memorias mencionan esta entidad
-- =====================================================

alter table entities
  add column if not exists rolling_summary_updated_at timestamptz,
  add column if not exists key_facts jsonb default '{}'::jsonb,
  add column if not exists interaction_count integer not null default 0,
  add column if not exists summary_stale boolean not null default false,
  add column if not exists summary_payload jsonb;

-- Ãndices Ãºtiles para listar y queries
create index if not exists entities_interaction_count_idx
  on entities (user_id, interaction_count desc);

create index if not exists entities_summary_stale_idx
  on entities (user_id, summary_stale) where summary_stale = true;

-- =====================================================
-- Sincronizar interaction_count con la realidad histÃ³rica
-- Se ejecuta una sola vez al aplicar la migraciÃ³n.
-- =====================================================
update entities e
set interaction_count = sub.cnt
from (
  select me.entity_id, count(*)::integer as cnt
  from memory_entities me
  join memories m on m.id = me.memory_id
  where m.status = 'active'
  group by me.entity_id
) sub
where e.id = sub.entity_id;

-- Marcar como stale todas las entidades con interacciones pero sin summary
-- (para que el siguiente cron las genere)
update entities
set summary_stale = true
where interaction_count > 0
  and (rolling_summary is null or rolling_summary = '');

-- =====================================================
-- Trigger: cuando se enlaza una nueva memoria con una entidad,
-- incrementar interaction_count, bumpear last_seen_at,
-- y marcar summary como stale.
-- =====================================================
create or replace function entities_on_memory_link()
returns trigger
language plpgsql
as $$
begin
  update entities
  set
    interaction_count = interaction_count + 1,
    last_seen_at = now(),
    summary_stale = true
  where id = new.entity_id;
  return new;
end;
$$;

drop trigger if exists trg_entities_on_memory_link on memory_entities;
create trigger trg_entities_on_memory_link
  after insert on memory_entities
  for each row
  execute function entities_on_memory_link();

-- Mantener consistencia cuando se eliminan enlaces
create or replace function entities_on_memory_unlink()
returns trigger
language plpgsql
as $$
begin
  update entities
  set
    interaction_count = greatest(0, interaction_count - 1),
    summary_stale = true
  where id = old.entity_id;
  return old;
end;
$$;

drop trigger if exists trg_entities_on_memory_unlink on memory_entities;
create trigger trg_entities_on_memory_unlink
  after delete on memory_entities
  for each row
  execute function entities_on_memory_unlink();

-- =====================================================
-- RPC para co-ocurrencia: dada una entidad, devuelve otras
-- entidades que aparecen junto a ella, ordenadas por frecuencia.
-- =====================================================
create or replace function entity_cooccurrence(
  p_entity_id uuid,
  p_limit integer default 8
)
returns table (
  id uuid,
  name text,
  entity_type text,
  cooccurrences integer
)
language sql
stable
as $$
  select
    e.id,
    e.name,
    e.entity_type,
    count(*)::integer as cooccurrences
  from memory_entities me1
  join memory_entities me2 on me1.memory_id = me2.memory_id and me2.entity_id <> p_entity_id
  join entities e on e.id = me2.entity_id
  where me1.entity_id = p_entity_id
  group by e.id, e.name, e.entity_type
  order by cooccurrences desc
  limit p_limit;
$$;


-- ============================================================
-- [6/16] 20260522000005_sprint7_digests.sql
-- ============================================================
-- =====================================================
-- LEXIS â€” MigraciÃ³n Sprint 7
-- Snapshots periÃ³dicos + preferencias de envÃ­o.
-- =====================================================

-- Cadencia configurable por usuario
do $$ begin
  create type digest_cadence as enum ('weekly', 'biweekly', 'monthly');
exception when duplicate_object then null; end $$;

do $$ begin
  create type digest_status as enum ('draft', 'sent', 'failed', 'skipped');
exception when duplicate_object then null; end $$;

-- =====================================================
-- Preferencias del usuario
-- =====================================================
create table if not exists digest_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  cadence digest_cadence not null default 'weekly',
  send_hour_utc smallint not null default 7,       -- 0-23, hora UTC del envÃ­o. 7 UTC = 8h EspaÃ±a (CET) / 9h CEST
  day_of_week smallint default 1,                  -- 0=domingo, 1=lunes, ...
  day_of_month smallint default 1,                 -- 1-28, para cadencia mensual
  email text,                                       -- destino (si null, usar el de auth.users)
  last_sent_at timestamptz,
  updated_at timestamptz default now()
);

alter table digest_preferences enable row level security;

create policy "own_digest_prefs" on digest_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =====================================================
-- Snapshots generados (histÃ³rico)
-- =====================================================
create table if not exists digests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,

  period_start timestamptz not null,
  period_end timestamptz not null,
  cadence digest_cadence not null,

  -- Resultado del LLM: headline, sections, highlights, stale, metrics, etc.
  payload jsonb not null,

  -- MÃ©tricas crudas calculadas en SQL
  metrics jsonb not null default '{}'::jsonb,

  -- Render HTML del email
  html_email text,

  -- Estado del envÃ­o
  status digest_status not null default 'draft',
  sent_at timestamptz,
  sent_to text,                            -- email destinatario real
  resend_message_id text,                  -- id devuelto por Resend
  send_error text,

  model_used text,
  generated_at timestamptz not null default now()
);

create index if not exists digests_user_period_idx
  on digests (user_id, period_start desc);

create index if not exists digests_status_idx
  on digests (status, generated_at desc);

alter table digests enable row level security;

create policy "own_digests" on digests
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =====================================================
-- Inicializar preferencias del usuario actual si no existen
-- (idempotente: si el user ya tiene preferencias, no las pisa)
-- =====================================================
insert into digest_preferences (user_id, enabled, cadence)
select id, true, 'weekly'
from auth.users
on conflict (user_id) do nothing;


-- ============================================================
-- [7/16] 20260522000006_sprint8_search_metrics.sql
-- ============================================================
-- =====================================================
-- LEXIS â€” MigraciÃ³n Sprint 8
-- RPCs para bÃºsqueda y timeline con filtros ricos.
-- Sin cambios de schema, solo funciones.
-- =====================================================

-- =====================================================
-- search_memories_filtered: bÃºsqueda semÃ¡ntica con filtros mÃºltiples
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
-- Agrupa memorias por dÃ­a/semana/mes segÃºn granularidad.
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
-- user_metrics_snapshot: vista Ãºnica con mÃ©tricas agregadas
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


-- ============================================================
-- [8/16] 20260522000007_sprint9_api_tokens.sql
-- ============================================================
-- =====================================================
-- LEXIS â€” MigraciÃ³n Sprint 9
-- Personal Access Tokens para la API pÃºblica v1.
-- =====================================================

do $$ begin
  create type pat_scope as enum ('read', 'write');
exception when duplicate_object then null; end $$;

create table if not exists personal_access_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,

  name text not null,                              -- "n8n production", "mi laptop", etc.
  token_hash text not null unique,                 -- SHA-256 hex del token plano
  token_prefix text not null,                      -- primeros 8 chars del plano, para mostrar al user
  token_last_four text not null,                   -- Ãºltimos 4 chars, para mostrar al user

  scopes pat_scope[] not null default array['read']::pat_scope[],

  last_used_at timestamptz,
  last_used_ip text,
  last_used_user_agent text,

  expires_at timestamptz,                          -- opcional, null = sin caducidad
  revoked_at timestamptz,                          -- null = activo

  created_at timestamptz default now()
);

create index if not exists pat_user_idx
  on personal_access_tokens (user_id, created_at desc);

create index if not exists pat_hash_idx
  on personal_access_tokens (token_hash) where revoked_at is null;

alter table personal_access_tokens enable row level security;

-- El user solo ve y gestiona sus propios tokens.
create policy "own_pat" on personal_access_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =====================================================
-- FunciÃ³n helper: bumpear last_used_at de forma barata desde la API.
-- Recibe el hash, no requiere RLS porque corre con SECURITY DEFINER.
-- =====================================================
create or replace function bump_pat_last_used(
  p_token_hash text,
  p_ip text default null,
  p_user_agent text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update personal_access_tokens
  set
    last_used_at = now(),
    last_used_ip = coalesce(p_ip, last_used_ip),
    last_used_user_agent = coalesce(p_user_agent, last_used_user_agent)
  where token_hash = p_token_hash
    and revoked_at is null
    and (expires_at is null or expires_at > now());
$$;

revoke all on function bump_pat_last_used(text, text, text) from public;
grant execute on function bump_pat_last_used(text, text, text) to authenticated, anon, service_role;


-- ============================================================
-- [9/16] 20260522000008_sprint10_connectors.sql
-- ============================================================
-- =====================================================
-- LEXIS â€” MigraciÃ³n Sprint 10
-- Infraestructura base de Connectors.
--
-- Tres tablas:
--   1. connector_credentials â€” tokens OAuth y secretos por provider
--   2. connectors            â€” instancias configuradas (Gmail trabajo, Drive personal, etc.)
--   3. connector_runs        â€” histÃ³rico de ejecuciones para observabilidad
-- =====================================================

-- ----- Enums -----

do $$ begin
  create type connector_run_status as enum ('running', 'success', 'failed', 'partial');
exception when duplicate_object then null; end $$;

do $$ begin
  create type connector_run_trigger as enum ('cron', 'manual', 'webhook');
exception when duplicate_object then null; end $$;

-- =====================================================
-- connector_credentials
-- Guarda tokens OAuth y API keys. Una credential puede ser
-- compartida por varios connectors del mismo provider (e.g.
-- una cuenta Google sirviendo a Gmail + Drive).
--
-- Las columnas text son el contenedor histÃ³rico. El runtime actual escribe
-- sobres AES-256-GCM enc:v1 y rechaza texto plano. Instalaciones anteriores
-- deben ejecutar scripts/migrate-connector-credentials.mjs antes de operar.
-- =====================================================

create table if not exists connector_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,

  provider text not null,                    -- 'google', 'microsoft', 'notion', 'api_key', etc.
  label text not null,                       -- "Cuenta Google trabajo"
  account_identifier text,                   -- "javi@porcelanosa.com" (display only)

  access_token text,                         -- vacÃ­o para credenciales basadas en API key
  refresh_token text,
  expires_at timestamptz,

  api_key text,                              -- para conectores con API key simple

  scopes text[] default '{}',

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists cc_user_provider_idx
  on connector_credentials (user_id, provider);

alter table connector_credentials enable row level security;

create policy "own_credentials" on connector_credentials
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =====================================================
-- connectors
--
-- schedule: lenguaje simple
--   - null         â†’ solo se ejecuta vÃ­a webhook o trigger manual
--   - "every:15m"  â†’ cada 15 minutos
--   - "every:1h"   â†’ cada hora
--   - "every:6h"   â†’ cada 6 horas
--   - "every:1d"   â†’ cada dÃ­a
--   - "daily:7"    â†’ todos los dÃ­as a las 7 UTC
--
-- webhook_secret_hash: SHA-256 del secret en plain. El plain se
-- muestra una sola vez al crear, igual que los PATs.
-- =====================================================

create table if not exists connectors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,

  type text not null,                        -- 'gmail', 'drive', 'rss', 'webhook', etc.
  name text not null,
  enabled boolean not null default true,

  schedule text,                             -- ver formato arriba; null = sin schedule
  config jsonb not null default '{}'::jsonb,

  credentials_id uuid references connector_credentials(id) on delete set null,

  webhook_secret_hash text,                  -- presente solo en connectors que aceptan webhook entrante
  webhook_secret_prefix text,                -- primeros 8 chars del plain

  last_run_at timestamptz,
  last_run_status connector_run_status,
  last_error text,
  last_state jsonb default '{}'::jsonb,      -- cursor, last_id, page_token...

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists connectors_user_idx
  on connectors (user_id, enabled, last_run_at);

create index if not exists connectors_webhook_hash_idx
  on connectors (webhook_secret_hash) where webhook_secret_hash is not null;

alter table connectors enable row level security;

create policy "own_connectors" on connectors
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =====================================================
-- connector_runs
-- Cada ejecuciÃ³n crea una fila. Ãštil para debug y mÃ©tricas.
-- =====================================================

create table if not exists connector_runs (
  id uuid primary key default gen_random_uuid(),
  connector_id uuid references connectors(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,

  status connector_run_status not null default 'running',
  trigger connector_run_trigger not null,

  started_at timestamptz default now(),
  completed_at timestamptz,

  items_fetched integer default 0,
  items_new integer default 0,
  items_skipped integer default 0,
  items_failed integer default 0,

  error_message text,
  payload jsonb default '{}'::jsonb         -- info de debug (request_ids, page_tokens consumidos, etc.)
);

create index if not exists cr_connector_started_idx
  on connector_runs (connector_id, started_at desc);

create index if not exists cr_user_started_idx
  on connector_runs (user_id, started_at desc);

alter table connector_runs enable row level security;

create policy "own_runs" on connector_runs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =====================================================
-- Helper RPC para listar connectors con sus stats agregadas
-- (Ãºtil para la pÃ¡gina /connectors)
-- =====================================================

create or replace function list_connectors_with_stats(p_user_id uuid)
returns table (
  id uuid,
  type text,
  name text,
  enabled boolean,
  schedule text,
  config jsonb,
  last_run_at timestamptz,
  last_run_status connector_run_status,
  last_error text,
  has_webhook boolean,
  runs_24h integer,
  items_24h integer,
  created_at timestamptz
)
language sql
stable
as $$
  select
    c.id,
    c.type,
    c.name,
    c.enabled,
    c.schedule,
    c.config,
    c.last_run_at,
    c.last_run_status,
    c.last_error,
    (c.webhook_secret_hash is not null) as has_webhook,
    coalesce((
      select count(*)::int
      from connector_runs r
      where r.connector_id = c.id
        and r.started_at > now() - interval '24 hours'
    ), 0) as runs_24h,
    coalesce((
      select sum(r.items_new)::int
      from connector_runs r
      where r.connector_id = c.id
        and r.started_at > now() - interval '24 hours'
    ), 0) as items_24h,
    c.created_at
  from connectors c
  where c.user_id = p_user_id
  order by c.created_at desc;
$$;


-- ============================================================
-- [10/16] 20260523000000_sprint14_user_settings.sql
-- ============================================================
-- =====================================================
-- Sprint 14 Â· user_settings
--
-- Tabla de preferencias del usuario que es infraestructura
-- transversal para Sprints 14-18:
--   - timezone: zona horaria del usuario (Europe/Madrid default).
--               Todos los crons consultan esto antes de "Â¿toca disparar?".
--   - quiet_hours_*: ventana de silencio para push notifications.
--   - draft_calendar_id: ID del calendario "Lexis Â· Borradores" en
--                        Google Calendar que se autocrearÃ¡ al primer
--                        uso de write. Si write_to_primary=true, se
--                        ignora y los eventos van al primario.
--
-- Una fila por usuario, creada lazy en el primer acceso.
-- =====================================================

create table if not exists user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'Europe/Madrid',
  preferred_language text not null default 'es',

  -- Push / silencio nocturno
  quiet_hours_start text not null default '22:00',     -- HH:MM en zona del usuario
  quiet_hours_end   text not null default '08:00',
  quiet_hours_enabled boolean not null default true,

  -- Calendar
  draft_calendar_id text,                              -- google calendar id (cuando se crea "Lexis Â· Borradores")
  write_to_primary boolean not null default false,     -- si true, las escrituras van directas a primary

  -- Push notifications globales
  push_enabled boolean not null default true,
  push_types_enabled jsonb not null default '{"deadlines":true,"meetings":true,"follow_ups":true,"reminders":true,"reviews":true}'::jsonb,
  push_offsets_minutes int[] not null default array[1440, 60, 15],  -- 24h, 1h, 15min antes

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table user_settings enable row level security;

create policy "user_settings_select_own" on user_settings
  for select using (user_id = auth.uid());

create policy "user_settings_insert_own" on user_settings
  for insert with check (user_id = auth.uid());

create policy "user_settings_update_own" on user_settings
  for update using (user_id = auth.uid());

-- Trigger updated_at
create or replace function tg_user_settings_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end
$$;

create trigger tg_user_settings_updated_at
  before update on user_settings
  for each row execute function tg_user_settings_updated_at();


-- ============================================================
-- [11/16] 20260523000001_sprint15_events.sql
-- ============================================================
-- =====================================================
-- Sprint 15 Â· events
--
-- Tabla canÃ³nica de "cosas con fecha que Lexis tiene que recordar".
-- Cada fila representa un compromiso, deadline, reuniÃ³n, follow-up
-- o recordatorio, con due_at en UTC y status.
--
-- Pueblan esta tabla:
--   - Eventos sincronizados desde Google Calendar (Sprint 14)
--   - Eventos extraÃ­dos automÃ¡ticamente de memorias (extractor LLM)
--   - Eventos creados desde captura de imagen (Outlook foto)
--   - Eventos creados manualmente desde la UI
--
-- Sprint 17/18 (proactive_rules + agent_actions) leen de aquÃ­
-- para disparar avisos antes de un due_at, marcar follow-ups, etc.
-- =====================================================

create type event_type as enum (
  'deadline',     -- "antes del viernes"
  'meeting',      -- reuniÃ³n con attendees
  'follow_up',    -- "envÃ­o X a Y antes del Z"
  'reminder',     -- recordatorio neutro
  'recurring'     -- evento recurrente (instancia individual)
);

create type event_status as enum (
  'pending',      -- aÃºn no completado, due_at en futuro o reciente
  'done',         -- el user marcÃ³ "Hecho"
  'snoozed',      -- pospuesto, due_at se ha movido
  'cancelled',    -- ya no aplica
  'expired'       -- due_at pasÃ³ sin responder
);

create type event_source as enum (
  'calendar',     -- vino del connector calendar
  'voice',        -- extraÃ­do de captura por voz
  'image',        -- extraÃ­do de captura de imagen (foto Outlook)
  'text',         -- extraÃ­do de captura de texto / Drive / Gmail / RSS
  'manual'        -- creado a mano desde la UI
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- NÃºcleo temporal
  due_at timestamptz not null,
  ends_at timestamptz,                          -- para events con duraciÃ³n (meetings)
  all_day boolean not null default false,

  -- ClasificaciÃ³n
  type event_type not null,
  status event_status not null default 'pending',
  source event_source not null,

  -- Contenido
  title text not null,
  description text,

  -- Enlaces al grafo
  linked_memory_id uuid references memories(id) on delete set null,
  linked_project_id uuid references projects(id) on delete set null,
  linked_entity_id uuid references entities(id) on delete set null,

  -- Origen externo
  external_event_id text,                       -- e.g. gcal event id si aplica
  external_calendar_id text,                    -- e.g. gcal calendar id

  -- Calidad / metadata
  confidence float not null default 1.0,        -- 0-1; eventos LLM-extracted < 1.0
  metadata jsonb not null default '{}'::jsonb,

  -- Lifecycle
  responded_at timestamptz,
  response jsonb,                               -- { action: 'done' | 'snoozed' | ... }
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_events_user_due_pending
  on events (user_id, due_at)
  where status = 'pending';

create index idx_events_user_status
  on events (user_id, status, due_at);

create index idx_events_linked_memory on events (linked_memory_id) where linked_memory_id is not null;
create index idx_events_linked_project on events (linked_project_id) where linked_project_id is not null;
create index idx_events_linked_entity on events (linked_entity_id) where linked_entity_id is not null;
create index idx_events_external on events (external_calendar_id, external_event_id) where external_event_id is not null;

alter table events enable row level security;

create policy "events_select_own" on events
  for select using (user_id = auth.uid());

create policy "events_insert_own" on events
  for insert with check (user_id = auth.uid());

create policy "events_update_own" on events
  for update using (user_id = auth.uid());

create policy "events_delete_own" on events
  for delete using (user_id = auth.uid());

-- Trigger updated_at
create or replace function tg_events_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end
$$;

create trigger tg_events_updated_at
  before update on events
  for each row execute function tg_events_updated_at();

-- RPC Ãºtil: prÃ³ximos N eventos pending de un user
create or replace function upcoming_events(
  p_user_id uuid,
  p_horizon_days int default 14,
  p_limit int default 50
) returns setof events
language sql stable as $$
  select *
  from events
  where user_id = p_user_id
    and status = 'pending'
    and due_at >= now() - interval '1 day'
    and due_at <= now() + (p_horizon_days || ' days')::interval
  order by due_at asc
  limit p_limit;
$$;

grant execute on function upcoming_events(uuid, int, int) to authenticated;


-- ============================================================
-- [12/16] 20260523000002_sprint16_push.sql
-- ============================================================
-- =====================================================
-- Sprint 16 Â· push_subscriptions
--
-- Suscripciones Web Push (VAPID) por dispositivo del usuario.
-- Cuando un user instala la PWA en un dispositivo y acepta
-- notificaciones, el navegador genera un objeto PushSubscription
-- que guardamos aquÃ­. DespuÃ©s usamos web-push server-side para
-- enviarle pushes (Sprint 17 dispara, Sprint 16 entrega).
--
-- Una row por (user_id, endpoint). Endpoint es la URL que cada
-- proveedor push (FCM/Mozilla/Apple) entrega; identifica unÃ­voca-
-- mente el dispositivo + browser.
-- =====================================================

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  keys jsonb not null,                                   -- { p256dh: '...', auth: '...' }
  user_agent text,                                       -- snapshot navegador/dispositivo
  label text,                                            -- nombre amable que el user puede poner ("iPhone Javi")
  last_used_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index idx_push_subs_user on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;

create policy "push_subs_select_own" on push_subscriptions
  for select using (user_id = auth.uid());

create policy "push_subs_insert_own" on push_subscriptions
  for insert with check (user_id = auth.uid());

create policy "push_subs_update_own" on push_subscriptions
  for update using (user_id = auth.uid());

create policy "push_subs_delete_own" on push_subscriptions
  for delete using (user_id = auth.uid());


-- ============================================================
-- [13/16] 20260523000003_sprint17_proactive_rules.sql
-- ============================================================
-- =====================================================
-- Sprint 17 Â· proactive_rules
--
-- Reglas que disparan acciones automÃ¡ticas sin que el user las pida.
-- Dos categorÃ­as:
--   - preset: las 5 reglas hardcoded del producto (autocreadas lazy
--             la primera vez que el user entra en /settings/proactive).
--             Se identifican por preset_key. El user puede deshabilitar
--             pero no borrar (al volver al settings se vuelven a sugerir).
--   - custom: reglas que el user crea desde la UI. Antes de guardarse,
--             pasan por el detector de incongruencias contra todas las
--             reglas activas; si hay conflicto, el user decide.
--
-- Dos tipos de trigger:
--   - cron: expresiÃ³n cron interpretada en zona del user.
--   - event: condiciÃ³n evaluada por cÃ³digo sobre el grafo (e.g.
--            "evento prÃ³ximo en 30min con attendees externos").
--
-- Sprint 18 (agent_actions) leerÃ¡ last_fired_at + next_due_at para no
-- duplicar acciones.
-- =====================================================

create table if not exists proactive_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  kind text not null check (kind in ('preset', 'custom')),
  preset_key text,                          -- referencia canÃ³nica si kind='preset'

  name text not null,
  description text,

  trigger_type text not null check (trigger_type in ('cron', 'event')),
  trigger_config jsonb not null,            -- { cron: "30 7 * * 1" } o { event_kind: "...", ...params }

  action_type text not null,                -- "push_simple", "push_review", "push_followup", "push_dormant_project", "push_pre_meeting"
  action_payload jsonb not null default '{}'::jsonb,

  enabled boolean not null default true,
  timezone text not null default 'Europe/Madrid',

  last_fired_at timestamptz,
  next_due_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, preset_key)               -- evita duplicar presets
);

create index idx_proactive_user_enabled on proactive_rules (user_id, enabled);
create index idx_proactive_next_due on proactive_rules (next_due_at) where enabled = true;
create index idx_proactive_kind on proactive_rules (user_id, kind);

alter table proactive_rules enable row level security;

create policy "pr_select_own" on proactive_rules
  for select using (user_id = auth.uid());
create policy "pr_insert_own" on proactive_rules
  for insert with check (user_id = auth.uid());
create policy "pr_update_own" on proactive_rules
  for update using (user_id = auth.uid());
create policy "pr_delete_own" on proactive_rules
  for delete using (user_id = auth.uid());

create or replace function tg_proactive_rules_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end
$$;

create trigger tg_proactive_rules_updated_at
  before update on proactive_rules
  for each row execute function tg_proactive_rules_updated_at();


-- ============================================================
-- [14/16] 20260523000004_sprint18_agent_actions.sql
-- ============================================================
-- =====================================================
-- Sprint 18 Â· agent_actions
--
-- Bandeja de cosas que Lexis le pide al user que decida.
-- Cada vez que una proactive_rule dispara, ademÃ¡s de mandar push,
-- crea una fila aquÃ­. La UI /inbox las muestra como tarjetas con
-- quick replies tappeables.
--
-- Lifecycle:
--   pending â†’ responded | dismissed | expired
--
-- Las responses pueden tener efectos en el grafo (cerrar evento,
-- archivar proyecto, etc.) que se ejecutan en el endpoint
-- /api/agent-actions/[id]/respond.
-- =====================================================

create type action_status as enum ('pending', 'responded', 'dismissed', 'expired');

create table if not exists agent_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rule_id uuid references proactive_rules(id) on delete set null,

  type text not null,                          -- 'capture_request' | 'review_prompt' | 'pre_meeting_context' | 'followup_check' | 'dormant_project_check' | 'custom_alert'
  title text not null,
  prompt text not null,
  context jsonb not null default '{}'::jsonb,

  quick_replies jsonb not null default '[]'::jsonb,
  -- [{ label: 'Hecho', action: 'mark_event_done', payload: { event_id: '...' } }, ...]

  open_route text,

  status action_status not null default 'pending',
  response jsonb,
  responded_at timestamptz,
  expires_at timestamptz,

  created_at timestamptz not null default now()
);

create index idx_aa_user_status_created on agent_actions (user_id, status, created_at desc);
create index idx_aa_expires on agent_actions (expires_at) where status = 'pending';
create index idx_aa_rule on agent_actions (rule_id);

alter table agent_actions enable row level security;

create policy "aa_select_own" on agent_actions
  for select using (user_id = auth.uid());
create policy "aa_insert_own" on agent_actions
  for insert with check (user_id = auth.uid());
create policy "aa_update_own" on agent_actions
  for update using (user_id = auth.uid());
create policy "aa_delete_own" on agent_actions
  for delete using (user_id = auth.uid());

-- RPC pendientes count (para badge del header)
create or replace function pending_actions_count(p_user_id uuid)
returns int language sql stable as $$
  select count(*)::int
  from agent_actions
  where user_id = p_user_id and status = 'pending'
    and (expires_at is null or expires_at > now());
$$;

grant execute on function pending_actions_count(uuid) to authenticated;


-- ============================================================
-- [15/16] 20260526000000_hardening.sql
-- ============================================================
-- =====================================================
-- Hardening Â· 2026-05-26 (post-auditorÃ­a)
--
-- MigraciÃ³n aditiva y segura, fruto de la auditorÃ­a de la app:
--   1. Ãndice Ãºnico anti-duplicados para connectors (external_id).
--   2. PolÃ­tica DELETE faltante en user_settings.
--
-- Es idempotente: se puede re-aplicar sin error.
-- Aplicar en Supabase SQL Editor (o supabase db push) DESPUÃ‰S de las 14
-- migraciones base. La DB ya estÃ¡ poblada/vacÃ­a sin duplicados, asÃ­ que el
-- Ã­ndice Ãºnico se crea sin conflicto.
-- =====================================================

-- ---------------------------------------------------------------------------
-- 1. Dedup determinista de memorias ingeridas por connectors.
--
-- El runner de connectors hace "SELECT por external_id, si no existe inserta",
-- lo cual NO es atÃ³mico: dos ejecuciones solapadas (cron + "Ejecutar ahora",
-- o dos ticks concurrentes) pueden insertar la misma memoria dos veces.
-- Este Ã­ndice Ãºnico parcial lo impide a nivel de BD. El external_id vive en
-- source_metadata->>'external_id' (sÃ³lo lo setean los connectors; las capturas
-- manuales no lo tienen â†’ el WHERE parcial las excluye).
-- ---------------------------------------------------------------------------
create unique index if not exists memories_user_external_id_uniq
  on memories (user_id, (source_metadata->>'external_id'))
  where source_metadata->>'external_id' is not null;

-- ---------------------------------------------------------------------------
-- 2. user_settings: faltaba la polÃ­tica DELETE (tenÃ­a select/insert/update).
--    Sin ella, RLS bloquea cualquier borrado (no es una fuga, pero impide al
--    usuario resetear sus settings desde el cliente). Por consistencia con el
--    resto de tablas, la aÃ±adimos.
-- ---------------------------------------------------------------------------
drop policy if exists "user_settings_delete_own" on user_settings;
create policy "user_settings_delete_own" on user_settings
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- NOTA (revisiÃ³n futura, NO incluido aquÃ­ por riesgo):
-- Las RPC parametrizadas por p_user_id (search_memories_filtered,
-- user_activity_buckets, user_metrics_snapshot, upcoming_events,
-- pending_actions_count, entity_cooccurrence, list_connectors_with_stats)
-- aceptan p_user_id sin contrastarlo con auth.uid(). HOY no es explotable
-- (son SECURITY INVOKER y RLS filtra), pero como defensa en profundidad
-- convendrÃ­a aÃ±adir al inicio de cada una:
--     if p_user_id is distinct from auth.uid() then
--       raise exception 'forbidden';
--     end if;
-- Requiere reescribir cada funciÃ³n con CREATE OR REPLACE preservando su firma
-- y cuerpo exactos; se deja para una migraciÃ³n dedicada y revisada.
-- ---------------------------------------------------------------------------


-- ============================================================
-- [16/16] 20260706000000_hardening2_search_memories.sql
-- ============================================================
-- =====================================================
-- Hardening 2 Â· 2026-07-06 (prerequisito de Acta S0.5)
--
-- search_memories filtraba EXCLUSIVAMENTE por auth.uid(). Bajo el
-- service client (API v1 /capture de Acta, crons) auth.uid() es NULL,
-- asÃ­ que el clasificador no veÃ­a vecinas y nunca deduplicaba.
--
-- Fix: parÃ¡metro opcional p_user_id. Con sesiÃ³n (anon client) sigue
-- funcionando igual (coalesce â†’ auth.uid()); bajo service role se pasa
-- explÃ­cito. Defensa en profundidad: la funciÃ³n es SECURITY INVOKER,
-- de modo que un caller anon que pase un p_user_id ajeno sigue filtrado
-- por RLS y no obtiene filas de otro usuario.
--
-- Nota: se hace DROP + CREATE (no OR REPLACE) porque aÃ±adir un parÃ¡metro
-- crea una sobrecarga y PostgREST fallarÃ­a con PGRST203 (ambigÃ¼edad)
-- al llamar sin p_user_id. La Ãºnica llamada en cÃ³digo es
-- src/lib/classifier/decide.ts (actualizada en el mismo commit).
-- =====================================================
--
-- Fix 2026-07-06 (error real al ejecutar: "42704: type vector does not
-- exist"): Supabase instala pgvector en el schema `extensions`, no en
-- `public`. El search_path de esta sesiÃ³n del SQL Editor no lo incluÃ­a
-- (probable tras el ciclo de pausa/reactivaciÃ³n del proyecto free tier),
-- asÃ­ que `vector(1024)` no resolvÃ­a al parsear el DDL de abajo. Las dos
-- lÃ­neas siguientes son idempotentes y de alcance solo-sesiÃ³n: no tocan
-- el search_path en tiempo de ejecuciÃ³n de la funciÃ³n para los callers
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

