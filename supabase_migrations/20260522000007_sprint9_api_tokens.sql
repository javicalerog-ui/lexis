-- =====================================================
-- LEXIS — Migración Sprint 9
-- Personal Access Tokens para la API pública v1.
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
  token_last_four text not null,                   -- últimos 4 chars, para mostrar al user

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
-- Función helper: bumpear last_used_at de forma barata desde la API.
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
