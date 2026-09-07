-- =====================================================
-- Fix P1 (auditoría externa 2026-09-08, verificado línea por línea)
--
-- Las políticas RLS de memory_projects/memory_entities
-- (20260522000000_initial_schema.sql:193-201) solo comprueban
-- que la MEMORIA es del usuario que escribe; nunca comprueban
-- que el project_id / entity_id enlazado también lo sea.
--
-- Efecto: un usuario A puede enlazar una memoria propia a un
-- project_id/entity_id de otro usuario B si conoce el UUID.
--   (a) fuga de metadatos vía /api/v1/search (enrichMemories
--       corre con el cliente service role del PAT, sin filtrar
--       propietario en el JOIN).
--   (b) más grave: el cron refresh-summaries agrega memorias
--       enlazadas sin filtrar propietario — el contenido de A
--       puede acabar redactado dentro del resumen de IA del
--       proyecto/entidad de B, sin que A tenga que hacer nada
--       más tras crear el enlace.
--
-- Fix: trigger que exige mismo user_id en ambos extremos del
-- enlace, en INSERT y UPDATE, para cualquier rol (incluido
-- service_role — los triggers no se saltan con RLS bypass).
--
-- Ver docs/PLAN-MIGRACION-CLAVIS-LEXIS.md, Fase 1 y riesgo #20.
-- =====================================================

-- 0. Salvaguarda: si ya existiera algún enlace cruzado (no debería,
--    solo hay un usuario en producción hoy), la migración FALLA en
--    vez de aplicar el trigger sobre datos ya contaminados.
do $$
declare
  bad_projects int;
  bad_entities int;
begin
  select count(*) into bad_projects
  from memory_projects mp
  join memories m on m.id = mp.memory_id
  join projects p on p.id = mp.project_id
  where m.user_id <> p.user_id;

  select count(*) into bad_entities
  from memory_entities me
  join memories m on m.id = me.memory_id
  join entities e on e.id = me.entity_id
  where m.user_id <> e.user_id;

  if bad_projects > 0 or bad_entities > 0 then
    raise exception
      'Enlaces cruzados existentes: % en memory_projects, % en memory_entities. '
      'Sanearlos (borrar o corregir) antes de aplicar esta migración — ver '
      'docs/PLAN-MIGRACION-CLAVIS-LEXIS.md riesgo #20.',
      bad_projects, bad_entities;
  end if;
end $$;

-- 1. Función de trigger compartida por ambas tablas.
create or replace function memory_link_same_owner()
returns trigger
language plpgsql
as $$
declare
  mem_user uuid;
  other_user uuid;
begin
  select user_id into mem_user from memories where id = new.memory_id;

  if tg_table_name = 'memory_projects' then
    select user_id into other_user from projects where id = new.project_id;
  elsif tg_table_name = 'memory_entities' then
    select user_id into other_user from entities where id = new.entity_id;
  else
    raise exception 'memory_link_same_owner: tabla no soportada %', tg_table_name;
  end if;

  if mem_user is null then
    raise exception 'memory_link_same_owner: memoria % no encontrada', new.memory_id;
  end if;

  if other_user is null then
    raise exception 'memory_link_same_owner: destino del enlace no encontrado en %', tg_table_name;
  end if;

  if mem_user <> other_user then
    raise exception
      'memory_link_same_owner: la memoria (user %) y el destino del enlace (user %) '
      'pertenecen a usuarios distintos — enlace cruzado bloqueado',
      mem_user, other_user;
  end if;

  return new;
end;
$$;

-- 2. Triggers en ambas tablas de enlace, en INSERT y UPDATE.
--    Corren para CUALQUIER rol (service_role incluido): un trigger
--    no se salta al hacer bypass de RLS, a diferencia de una policy.
drop trigger if exists memory_projects_same_owner on memory_projects;
create trigger memory_projects_same_owner
  before insert or update on memory_projects
  for each row execute function memory_link_same_owner();

drop trigger if exists memory_entities_same_owner on memory_entities;
create trigger memory_entities_same_owner
  before insert or update on memory_entities
  for each row execute function memory_link_same_owner();
