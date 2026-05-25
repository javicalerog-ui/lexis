-- =====================================================
-- Sprint 18 · agent_actions
--
-- Bandeja de cosas que Lexis le pide al user que decida.
-- Cada vez que una proactive_rule dispara, además de mandar push,
-- crea una fila aquí. La UI /inbox las muestra como tarjetas con
-- quick replies tappeables.
--
-- Lifecycle:
--   pending → responded | dismissed | expired
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
