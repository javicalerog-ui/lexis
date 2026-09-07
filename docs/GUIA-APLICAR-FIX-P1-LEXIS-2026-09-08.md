# GUÍA — Aplicar el fix del hallazgo P1 en Lexis (enlaces cruzados entre usuarios) · 2026-09-08

**Resultado final:** el trigger que bloquea enlazar una memoria propia a un proyecto/entidad de otro usuario queda instalado en la base de datos de Lexis. Cierra el hallazgo P1 de la auditoría (bloqueante de la Fase 1 del plan de migración).
**Tiempo estimado:** 5 min · **Necesitas:** estar logueado en Supabase con la cuenta que administra el proyecto de Lexis (org Porcelanosa, `javier.calero@porcelanosagrupo.com`)

## Antes de empezar

No hay ningún valor que tengas que rellenar tú — el SQL va completo, listo para pegar. Solo un aviso: tienes varios proyectos de Supabase en distintas organizaciones (gmail y Porcelanosa). Este paso es en el de la **org Porcelanosa**, proyecto **`cvtbzxeizdaihyitbphh`** (nombre visible: "Lexis" o similar) — no lo confundas con `clavis`, `market-pulse` o `radar-personal`, que están en la org de gmail.

## Fase 1 — Aplicar la migración

### Paso 1 — Entra en el proyecto correcto
1. Ve a `https://supabase.com/dashboard/projects` — con la cuenta **`javier.calero@porcelanosagrupo.com`** (org Porcelanosa).
2. En la lista de proyectos, entra en el que tiene el ID **`cvtbzxeizdaihyitbphh`** (compruébalo en la URL una vez dentro: `.../project/cvtbzxeizdaihyitbphh/...`).

✅ Verás: el dashboard del proyecto, con el menú lateral izquierdo (Table Editor, SQL Editor, Database, Auth...).
⚠️ Si ves un proyecto llamado "clavis", "market-pulse" o "radar-personal": estás en la org equivocada (gmail) o has entrado en otro proyecto. Vuelve a la lista y busca el ID exacto.

### Paso 2 — Abre el SQL Editor
1. En el menú lateral izquierdo, pulsa «**SQL Editor**» (icono de terminal, hacia la mitad del menú).
2. Pulsa «**New query**» (arriba a la derecha).

✅ Verás: un editor de texto vacío con un botón verde «Run» arriba a la derecha.

### Paso 3 — Pega y ejecuta la migración
1. Pega esto completo en el editor:

```sql
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
```

2. Pulsa «**Run**» (verde, arriba a la derecha, o Ctrl+Enter).

✅ Verás: abajo, «**Success. No rows returned**». Es el resultado esperado — la migración solo crea una función y dos triggers, no una tabla de datos.

⚠️ **Si ves un error que empieza por `Enlaces cruzados existentes: ...`**: significa que la comprobación de seguridad encontró datos ya contaminados (no debería pasar, hoy solo hay un usuario). **Para aquí, no reintentes nada, y pásame el mensaje de error completo tal cual** — lo diagnostico antes de seguir.

⚠️ Si ves cualquier OTRO error (sintaxis, permisos, tabla no existe): copia el mensaje completo y pásamelo — puede que alguna migración anterior no esté aplicada todavía.

### Paso 4 — Comprueba que los triggers quedaron instalados
1. En el mismo SQL Editor, abre una «New query» y pega:

```sql
select event_object_table, trigger_name
from information_schema.triggers
where trigger_name in ('memory_projects_same_owner', 'memory_entities_same_owner');
```

2. Pulsa «Run».

✅ Verás: una tabla de resultado con **2 filas** — `memory_projects` / `memory_projects_same_owner` y `memory_entities` / `memory_entities_same_owner`.

**Nota sobre la prueba de humo "de verdad":** lo ideal sería probar en vivo que un INSERT cruzando usuarios falla — pero hoy solo existe un usuario real (tú) en esta base de datos, así que no hay un segundo `project_id`/`entity_id` de otro dueño con el que fabricar el intento sin inventar datos falsos que luego habría que limpiar. Esta prueba de fuego se hará de forma natural en cuanto exista la cuenta de Silvestre (Fase 1-2 del plan) — la comprobación del Paso 4 (los triggers existen) es la verificación segura que podemos hacer hoy.

## Al terminar

Cuando hayas ejecutado el Paso 3 con éxito, dime «ya está» y compruebo yo mismo con una consulta de solo lectura que la función y los dos triggers existen y quedan bien definidos, antes de marcar el hallazgo P1 como cerrado en el plan.
