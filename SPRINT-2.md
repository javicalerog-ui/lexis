# Sprint 2 — Clasificador inteligente + grafo de proyectos y entidades

**Use case desbloqueado parcialmente**: #1 (preparación) y #3 (ficha de personas LIVE).
**Use case que prepara**: #1 (asistente proactivo) — el `rolling_summary` y `rolling_next_steps` ya se generan; Sprint 3 los expone con interactividad de "¿qué hago ahora?".

---

## Qué se ha implementado

### Núcleo: clasificador + grafo

| Módulo | Archivo | Función |
|---|---|---|
| Clasificador | `src/lib/classifier/decide.ts` | Decide `new` / `modification` / `redundant` con atajo de short-circuit si no hay vecinas cercanas |
| Prompt clasificador | `src/lib/classifier/prompts.ts` | Instrucciones conservadoras: en duda, "new" |
| Resolver proyectos | `src/lib/projects/resolve.ts` | Match exacto → trigram similarity → create. Slugs únicos auto |
| Attach proyectos | `src/lib/projects/attach.ts` | Upsert en `memory_projects` |
| Refresh summary | `src/lib/projects/refresh-summary.ts` | Regenera `rolling_summary` + `rolling_next_steps` con Sonnet 4.6 |
| Resolver entidades | `src/lib/entities/resolve.ts` | Match por nombre, alias o trigram, con embedding al crear |
| Attach entidades | `src/lib/entities/attach.ts` | Upsert en `memory_entities` |
| Slug util | `src/lib/utils/slug.ts` | Normaliza nombres → slugs únicos |

### Pipeline actualizado

`src/lib/ingestion/pipeline.ts` ahora:
1. LLM resume + extrae proyectos/entidades.
2. Embed.
3. **Clasifica** (con atajo si la similitud máx < 0.65 evita llamada LLM).
4. Si `redundant` → no inserta, log, retorna.
5. Si `modification` → marca la antigua como `superseded` ANTES de insertar la nueva.
6. INSERT memory.
7. Resuelve y enlaza proyectos (`memory_projects`) y entidades (`memory_entities`).
8. Si era `modification`, hereda attachments de la memory predecesora.
9. Log completo en `ingestion_log` (decision, model, processing_ms).

### Migración SQL adicional

`supabase_migrations/20260522000001_sprint2_functions.sql`:

- `project_name_similarity(p_user, p_query)` — trigram match sobre nombre y slug.
- `entity_name_similarity(p_user, p_query, p_type)` — trigram sobre nombre y aliases.
- `memory_attachments(p_memory_id)` — agregación JSONB de proyectos + entidades enlazadas (útil en sprint 3).
- Trigger `bump_project_activity` en `memory_projects` → bumpea `projects.last_activity_at` automáticamente.

### API Routes

| Endpoint | Función |
|---|---|
| `GET /api/projects` | Lista proyectos con `memory_count` |
| `POST /api/projects` | Crea proyecto manual |
| `GET /api/projects/[slug]` | Detalle: proyecto + memorias + entidades co-ocurrentes + refresh oportunista |
| `PATCH /api/projects/[slug]` | Edita name/description/status |
| `GET /api/entities?type=person` | Lista entidades, opcionalmente filtradas por tipo |
| `GET /api/entities/[id]` | Detalle: entidad + memorias + proyectos donde aparece |
| `POST /api/cron/refresh-summaries` | Cron protegido (`Authorization: Bearer <CRON_SECRET>`) para regenerar rolling summaries de proyectos stale |

### UI

| Ruta | Pantalla |
|---|---|
| `/projects` | Lista por sección: Activos / Pausados / Cerrados, con `ProjectCard` (glassmorphism, glow hover) |
| `/projects/[slug]` | Detalle editorial: título grande, estado actual, próximos pasos numerados, chips de personas/entidades por tipo (color-coded), histórico de memorias |
| `/entities` | Agrupado por tipo (persona / org / lugar / concepto / producto) con dots de color, chips compactos |
| `/entities/[id]` | Ficha: nombre + alias + atributos + proyectos donde aparece + memorias |
| `/` (chat) | Header actualizado con nav a `/projects` (✦) y `/entities` (◇) |

---

## Flujo de captura actualizado (paso a paso)

```
[Usuario captura una entrada]
  ↓
LLM SUMMARIZE_PROMPT
  ├─ summary_md
  ├─ content_normalized
  ├─ projects: ["Clavis", "IBD"]
  └─ entities: [{name:"Alfonso", type:"person"}, ...]
  ↓
voyage.embedOne(content + summary)
  ↓
CLASSIFIER
  ├─ search_memories(embedding, top 5)
  ├─ if max_similarity < 0.65 → decision='new' (no LLM)
  └─ else → LLM CLASSIFIER_PROMPT con candidatas
  ↓
┌─────────────────┬─────────────────────┬──────────────────┐
│  REDUNDANT      │  MODIFICATION       │  NEW             │
├─────────────────┼─────────────────────┼──────────────────┤
│ Log, no inserta │ UPDATE old.status=  │ INSERT memory    │
│                 │   'superseded'      │                  │
│                 │ INSERT new memory   │                  │
│                 │ Hereda attachments  │                  │
└─────────────────┴─────────────────────┴──────────────────┘
  ↓
Resolver proyectos: match o crea en `projects`
Attach memory ↔ project en `memory_projects` (trigger bumpea last_activity_at)
  ↓
Resolver entidades: match (nombre/alias/trigram) o crea en `entities` (con embedding)
Attach memory ↔ entity en `memory_entities`
  ↓
Log en ingestion_log (decision, model, processing_ms)
  ↓
Response: { memory_id, decision, attached_projects, attached_entities }
```

---

## Cron de rolling summary

`POST /api/cron/refresh-summaries` con header `Authorization: Bearer $CRON_SECRET`.

**Tres formas de invocarlo**:

### A) Cloudflare Worker scheduled trigger (recomendado, gratis)

Crear un Worker independiente con `wrangler.toml`:
```toml
[triggers]
crons = ["0 * * * *"]
```

Y un handler que haga:
```js
export default {
  async scheduled(event, env) {
    await fetch('https://lexis.pages.dev/api/cron/refresh-summaries', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    });
  },
};
```

### B) GitHub Actions schedule

```yaml
# .github/workflows/refresh-summaries.yml
on:
  schedule:
    - cron: '0 * * * *'
jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -X POST https://lexis.pages.dev/api/cron/refresh-summaries \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
```

### C) Manual

Cuando entras a `/projects/[slug]`, el endpoint hace un refresh oportunista si está stale. Para tu caso mono-usuario esto suele bastar; el cron es buena práctica pero no estrictamente necesario al principio.

---

## Decisiones técnicas notables

1. **Short-circuit del clasificador**: si la mejor candidata vecina tiene similitud < 0.65, decisión `new` sin gastar LLM. Esto convierte el 70-90% de capturas en clasificaciones gratuitas.
2. **Validación de `target_memory_id` post-LLM**: si Gemini alucina un id, caemos a la mejor candidata. Defensivo pero necesario.
3. **`superseded` no se borra**: las memorias modificadas quedan en DB con `status='superseded'`. Permite auditoría y rollback. La búsqueda solo devuelve `status='active'`.
4. **Trigger DB para `last_activity_at`**: en lugar de hacerlo desde el código (que puede fallar), un trigger SQL bumpea automáticamente al insertar en `memory_projects`. Determinista, simple.
5. **Embeddings de proyectos y entidades**: cada `project` y `entity` tiene su propio embedding (del nombre/summary). Habilita búsqueda semántica de proyectos/entidades sin queries de texto en sprint 3+.
6. **Rolling summary con Sonnet (tier deep)**: estos resúmenes se generan raramente (~1/hora por proyecto) y son la base del asistente proactivo. Coste alto justificado por calidad.
7. **Trigram similarity (`pg_trgm`)**: para fuzzy match de nombres de proyectos/entidades. Mucho más rápido que embedding similarity para esto y suficiente para detectar "Clavis" ≈ "clavis" o "Gaiata 1" ≈ "Gaiata I".
8. **Heredar attachments en modificaciones**: si una nueva memory modifica una vieja, conserva sus links a proyectos y entidades. Evita que la "actualización" quede huérfana en el grafo.

---

## Cómo probar Sprint 2

Tras `npm install` y aplicar la nueva migración:

```sql
-- En Supabase SQL Editor:
-- (ejecutar el contenido de supabase_migrations/20260522000001_sprint2_functions.sql)
```

### Smoke test

1. **Captura inicial**: "Hoy he tenido reunión con Alfonso Muñoz sobre la expansión de Porcelanosa a Polonia. Decidimos abrir Varsovia primero."
   - Esperado: memory creada, proyecto "Porcelanosa" o "Expansión Polonia" creado, entidad "Alfonso Muñoz" (person) y "Varsovia" (place) creadas.
   - Ir a `/projects` y `/entities` y verificar.

2. **Captura redundante**: "Reunión con Alfonso, expansión a Polonia, decisión: Varsovia primero."
   - Esperado: el clasificador decide `redundant`. No se inserta nueva memory.
   - Verificar en SQL: `select decision, count(*) from ingestion_log group by decision;`

3. **Captura de modificación**: "Cambio de plan: Cracovia antes que Varsovia para la expansión polaca."
   - Esperado: clasificador detecta `modification` sobre la memoria original. La antigua queda `status='superseded'`, la nueva hereda los proyectos/entidades.
   - Verificar: `select id, status, content from memories where source_metadata->>'supersedes' is not null;`

4. **Detalle de proyecto**: navegar a `/projects/[slug]` del proyecto creado. El rolling_summary debe regenerarse automáticamente con Sonnet y mostrarse junto a próximos pasos.

5. **Detalle de entidad**: navegar a `/entities` → click en "Alfonso Muñoz". Ver memorias y proyectos donde aparece.

### Inspección SQL

```sql
-- Ver decisiones del clasificador
select
  decision,
  count(*),
  avg(decision_confidence)::numeric(3,2) as avg_conf,
  avg(processing_ms)::int as avg_ms
from ingestion_log
group by decision;

-- Memorias con sus proyectos
select
  m.id, m.summary,
  array_agg(p.name) as projects
from memories m
left join memory_projects mp on mp.memory_id = m.id
left join projects p on p.id = mp.project_id
where m.status = 'active'
group by m.id;

-- Entidades más mencionadas
select
  e.name, e.entity_type, count(me.memory_id) as mentions
from entities e
left join memory_entities me on me.entity_id = e.id
group by e.id, e.name, e.entity_type
order by mentions desc;
```

---

## Pendiente para Sprint 3

- Endpoint `/api/projects/[slug]/next-steps` interactivo: dado el estado actual + una pregunta del usuario, generar siguientes pasos contextualizados.
- Botón **"¿Qué hago ahora?"** en `/projects/[slug]` que dispara dicho endpoint y muestra una propuesta accionable.
- Vista de feed proactivo: dashboard con "lo que merece tu atención esta semana" agregando proyectos con próximos pasos pendientes.
- Notificaciones (opcional): si un proyecto lleva N días sin actividad o tiene next_steps no atendidos.

---

## Checklist de cierre Sprint 2

- [ ] Migración SQL Sprint 2 aplicada en Supabase.
- [ ] `CRON_SECRET` añadido en `.env.local` y en Cloudflare Pages env vars.
- [ ] Captura nueva crea proyecto y entidades automáticamente.
- [ ] Captura redundante no inserta memoria nueva (verificado vía `ingestion_log.decision`).
- [ ] Captura de modificación marca la anterior como `superseded` y hereda attachments.
- [ ] `/projects` lista proyectos con `memory_count`.
- [ ] `/projects/[slug]` muestra `rolling_summary` y `rolling_next_steps` generados.
- [ ] `/entities` agrupa por tipo con color-coding.
- [ ] `/entities/[id]` muestra memorias y proyectos donde aparece la entidad.
- [ ] Cron (Cloudflare Worker o GitHub Actions) configurado y funcionando.
