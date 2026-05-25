-- =====================================================
-- LEXIS — Migración inicial
-- Sprint 0: schema base, pgvector, RLS
-- Embeddings: voyage-4-lite (1024 dims, Matryoshka)
-- =====================================================

-- Extensiones requeridas
create extension if not exists vector;
create extension if not exists pg_trgm;
create extension if not exists "uuid-ossp";

-- =====================================================
-- TABLA: memories
-- Unidad atómica de captura. Toda entrada del sistema
-- (texto, voz transcrita, imagen captioneada, PDF
-- parseado, fila relevante de XLSX) se persiste aquí.
-- =====================================================
create table memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,

  -- Contenido
  content text not null,                  -- texto original o caption generado
  summary text,                            -- resumen MD generado por LLM
  raw_excerpt text,                        -- fragmento literal sin procesar (auditoría)

  -- Origen
  source_type text not null,               -- 'text' | 'voice' | 'image' | 'pdf' | 'xlsx' | 'md' | 'url'
  source_uri text,                         -- ruta en Supabase Storage si aplica
  source_metadata jsonb default '{}'::jsonb,  -- exif, autor PDF, hoja XLSX, etc.

  -- Embedding semántico
  embedding vector(1024),                  -- voyage-4-lite

  -- Temporalidad
  captured_at timestamptz default now(),   -- cuándo ocurrió el hecho real
  ingested_at timestamptz default now(),   -- cuándo entró en Lexis

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
  rolling_summary text,                    -- estado actual, regenerado periódicamente
  rolling_next_steps text,                 -- propuestas activas del asistente
  rolling_summary_updated_at timestamptz,

  -- Búsqueda semántica sobre proyectos
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

  name text not null,                      -- "Alfonso Muñoz"
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
-- Auditoría del clasificador (Sprint 2). Decide si
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
  decision_model text,                     -- 'gemini-flash' | 'sonnet-4.6' (escalación)

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
-- desde el día 1 para soberanía y portabilidad futura.
-- (Anti-patrón del podcast: confiar la seguridad al
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
-- FUNCIÓN RPC: búsqueda semántica
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
