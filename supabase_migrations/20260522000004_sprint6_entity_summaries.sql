-- =====================================================
-- LEXIS — Migración Sprint 6
-- Fichas de entidad enriquecidas:
--   - rolling_summary ya existe; añadimos updated_at y stale flag
--   - key_facts: atributos canónicos destilados (rol, organización, etc.)
--   - interaction_count: cuántas memorias mencionan esta entidad
-- =====================================================

alter table entities
  add column if not exists rolling_summary_updated_at timestamptz,
  add column if not exists key_facts jsonb default '{}'::jsonb,
  add column if not exists interaction_count integer not null default 0,
  add column if not exists summary_stale boolean not null default false,
  add column if not exists summary_payload jsonb;

-- Índices útiles para listar y queries
create index if not exists entities_interaction_count_idx
  on entities (user_id, interaction_count desc);

create index if not exists entities_summary_stale_idx
  on entities (user_id, summary_stale) where summary_stale = true;

-- =====================================================
-- Sincronizar interaction_count con la realidad histórica
-- Se ejecuta una sola vez al aplicar la migración.
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
