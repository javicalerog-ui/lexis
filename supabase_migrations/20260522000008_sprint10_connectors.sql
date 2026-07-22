-- =====================================================
-- LEXIS — Migración Sprint 10
-- Infraestructura base de Connectors.
--
-- Tres tablas:
--   1. connector_credentials — tokens OAuth y secretos por provider
--   2. connectors            — instancias configuradas (Gmail trabajo, Drive personal, etc.)
--   3. connector_runs        — histórico de ejecuciones para observabilidad
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
-- Las columnas text son el contenedor histórico. El runtime actual escribe
-- sobres AES-256-GCM enc:v1 y rechaza texto plano. Instalaciones anteriores
-- deben ejecutar scripts/migrate-connector-credentials.mjs antes de operar.
-- =====================================================

create table if not exists connector_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,

  provider text not null,                    -- 'google', 'microsoft', 'notion', 'api_key', etc.
  label text not null,                       -- "Cuenta Google trabajo"
  account_identifier text,                   -- "javi@porcelanosa.com" (display only)

  access_token text,                         -- vacío para credenciales basadas en API key
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
--   - null         → solo se ejecuta vía webhook o trigger manual
--   - "every:15m"  → cada 15 minutos
--   - "every:1h"   → cada hora
--   - "every:6h"   → cada 6 horas
--   - "every:1d"   → cada día
--   - "daily:7"    → todos los días a las 7 UTC
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
-- Cada ejecución crea una fila. Útil para debug y métricas.
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
-- (útil para la página /connectors)
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
