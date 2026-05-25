-- =====================================================
-- LEXIS — Migración Sprint 4
-- Sesiones de entrevista para vaciado histórico.
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

  title text,                                  -- generado a posteriori, resumen 1 línea
  questions_asked integer not null default 0,
  memories_generated integer not null default 0,
  saturation_signal float,                     -- 0-1, según el LLM, cuán saturada está la sesión

  created_at timestamptz default now(),
  last_message_at timestamptz default now(),
  completed_at timestamptz
);

create index if not exists interview_sessions_user_status_idx
  on interview_sessions (user_id, status, last_message_at desc);

-- Mensajes de la sesión (conversación entrevistador ↔ usuario)
create table if not exists interview_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references interview_sessions(id) on delete cascade not null,

  role interview_role not null,
  content text not null,

  -- Cuando el user responde, la respuesta se ingesta como memoria.
  -- Guardamos la referencia para trazabilidad.
  memory_id uuid references memories(id) on delete set null,

  -- Solo para mensajes del assistant
  reasoning text,                              -- por qué esta pregunta (debug)
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
