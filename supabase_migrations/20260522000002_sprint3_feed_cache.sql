-- =====================================================
-- LEXIS — Migración Sprint 3
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

-- Función para limpiar cache expirado (puede llamarse vía cron)
create or replace function cleanup_expired_feed_cache()
returns integer
language sql
as $$
  with deleted as (
    delete from feed_cache where expires_at < now() returning user_id
  )
  select count(*)::integer from deleted;
$$;
