-- =====================================================
-- Sprint 15 · events
--
-- Tabla canónica de "cosas con fecha que Lexis tiene que recordar".
-- Cada fila representa un compromiso, deadline, reunión, follow-up
-- o recordatorio, con due_at en UTC y status.
--
-- Pueblan esta tabla:
--   - Eventos sincronizados desde Google Calendar (Sprint 14)
--   - Eventos extraídos automáticamente de memorias (extractor LLM)
--   - Eventos creados desde captura de imagen (Outlook foto)
--   - Eventos creados manualmente desde la UI
--
-- Sprint 17/18 (proactive_rules + agent_actions) leen de aquí
-- para disparar avisos antes de un due_at, marcar follow-ups, etc.
-- =====================================================

create type event_type as enum (
  'deadline',     -- "antes del viernes"
  'meeting',      -- reunión con attendees
  'follow_up',    -- "envío X a Y antes del Z"
  'reminder',     -- recordatorio neutro
  'recurring'     -- evento recurrente (instancia individual)
);

create type event_status as enum (
  'pending',      -- aún no completado, due_at en futuro o reciente
  'done',         -- el user marcó "Hecho"
  'snoozed',      -- pospuesto, due_at se ha movido
  'cancelled',    -- ya no aplica
  'expired'       -- due_at pasó sin responder
);

create type event_source as enum (
  'calendar',     -- vino del connector calendar
  'voice',        -- extraído de captura por voz
  'image',        -- extraído de captura de imagen (foto Outlook)
  'text',         -- extraído de captura de texto / Drive / Gmail / RSS
  'manual'        -- creado a mano desde la UI
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Núcleo temporal
  due_at timestamptz not null,
  ends_at timestamptz,                          -- para events con duración (meetings)
  all_day boolean not null default false,

  -- Clasificación
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

-- RPC útil: próximos N eventos pending de un user
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
