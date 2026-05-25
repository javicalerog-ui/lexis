-- =====================================================
-- LEXIS — Migración Sprint 7
-- Snapshots periódicos + preferencias de envío.
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
  send_hour_utc smallint not null default 7,       -- 0-23, hora UTC del envío. 7 UTC = 8h España (CET) / 9h CEST
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
-- Snapshots generados (histórico)
-- =====================================================
create table if not exists digests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,

  period_start timestamptz not null,
  period_end timestamptz not null,
  cadence digest_cadence not null,

  -- Resultado del LLM: headline, sections, highlights, stale, metrics, etc.
  payload jsonb not null,

  -- Métricas crudas calculadas en SQL
  metrics jsonb not null default '{}'::jsonb,

  -- Render HTML del email
  html_email text,

  -- Estado del envío
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
