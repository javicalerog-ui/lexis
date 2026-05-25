-- =====================================================
-- Sprint 17 · proactive_rules
--
-- Reglas que disparan acciones automáticas sin que el user las pida.
-- Dos categorías:
--   - preset: las 5 reglas hardcoded del producto (autocreadas lazy
--             la primera vez que el user entra en /settings/proactive).
--             Se identifican por preset_key. El user puede deshabilitar
--             pero no borrar (al volver al settings se vuelven a sugerir).
--   - custom: reglas que el user crea desde la UI. Antes de guardarse,
--             pasan por el detector de incongruencias contra todas las
--             reglas activas; si hay conflicto, el user decide.
--
-- Dos tipos de trigger:
--   - cron: expresión cron interpretada en zona del user.
--   - event: condición evaluada por código sobre el grafo (e.g.
--            "evento próximo en 30min con attendees externos").
--
-- Sprint 18 (agent_actions) leerá last_fired_at + next_due_at para no
-- duplicar acciones.
-- =====================================================

create table if not exists proactive_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  kind text not null check (kind in ('preset', 'custom')),
  preset_key text,                          -- referencia canónica si kind='preset'

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
