# Sprint 6 — Fichas de entidad enriquecidas

**Use case desbloqueado**: memoria contextual de personas y organizaciones. Hasta ahora la entidad `Alfonso Muñoz` era una fila con `attributes = {rol: "jefe IBD", empresa: "Porcelanosa"}` y poco más. Sprint 6 le da una ficha viva con resumen narrativo, hechos canónicos, hilos abiertos contigo, red cercana y refresh automático.

---

## Qué se ha implementado

### Schema (`supabase_migrations/20260522000004_sprint6_entity_summaries.sql`)

Nuevas columnas en `entities`:

| Columna | Tipo | Para qué |
|---|---|---|
| `rolling_summary_updated_at` | timestamptz | Cuándo se regeneró por última vez |
| `key_facts` | jsonb | Atributos canónicos destilados (rol, organization, location, relationship, context) |
| `summary_payload` | jsonb | Resultado completo del LLM (summary + highlights + open_threads + confidence + metadatos) |
| `interaction_count` | integer | Cuántas memorias activas mencionan esta entidad |
| `summary_stale` | boolean | Flag para que el cron sepa cuándo refrescar |

Sincronización **histórica**: la migración recalcula `interaction_count` para todas las entidades existentes y marca como `stale` las que tengan interacciones pero no summary. La primera ejecución del cron las cubrirá.

**Triggers** sobre `memory_entities`:

- Al INSERT: `interaction_count++`, `last_seen_at = now()`, `summary_stale = true`.
- Al DELETE: `interaction_count--` (clamp en 0), `summary_stale = true`.

Esto significa que cualquier captura nueva (chat, importer, entrevista, completion de paso) marca automáticamente a sus entidades como pendientes de refresh sin que ningún código de aplicación tenga que recordarlo.

**RPC nueva** `entity_cooccurrence(entity_id, limit)`: dado un entity_id, devuelve las otras entidades que aparecen en sus mismas memorias, ordenadas por co-ocurrencia. Es la "red cercana" de cualquier persona/organización.

### Generador de summary (`src/lib/entities/refresh-summary.ts`)

`refreshEntitySummary(supabase, userId, entityId)`:

1. Carga la entidad, sus memorias activas (máx 30 recientes), proyectos donde aparece y co-ocurrencias top.
2. Si no hay memorias, limpia el summary y desmarca stale. Sin gastar LLM.
3. Llama a Sonnet 4.6 (tier deep) con `ENTITY_SUMMARY_PROMPT` y JSON mode.
4. El LLM devuelve `{summary, key_facts, highlights, open_threads, confidence}`.
5. Persiste en cuatro sitios: `rolling_summary` (para queries SQL), `key_facts` (estructurado), `summary_payload` (todo), `rolling_summary_updated_at`, y limpia `summary_stale`.

El prompt está instruido para ser **conservador** cuando hay pocas memorias y devolver `confidence` baja en ese caso. No inventa rol/organización si las memorias no lo soportan.

### API Routes

| Endpoint | Función |
|---|---|
| `POST /api/entities/[id]/refresh-summary` | Regenera el summary manualmente |
| `GET /api/entities/[id]` | Ahora incluye `cooccurrences` además de memorias y proyectos |
| `POST /api/cron/refresh-summaries` | **Extendido**: además de proyectos, refresca hasta 20 entidades stale por ejecución (con `interaction_count >= 2`, las más activas primero) |

### UI

**`/entities/[id]`** completamente rediseñada:

- **Hero**: nombre en tipografía display grande con gradiente sutil, aliases, contadores (interacciones + última visto en relativo).
- **EntitySummaryCard** (client component) destacada con glassmorphism y halo radial:
  - Resumen narrativo en 3-5 frases.
  - Botón ↻ que regenera on-demand con spinner.
  - Meta: cuándo se generó, badge "actualizable" si stale, memorias consideradas, confidence %.
  - Grid de **key_facts** como chips ordenados (Rol, Organización, Ubicación, Relación, Contexto). Solo aparecen los que el LLM consiguió poblar.
  - Sub-bloque **Lo destacado** (highlights) con bullets.
  - Sub-bloque **Hilos abiertos** (open_threads) con bullets.
  - Estados vacíos: si no hay memorias, mensaje neutro. Si hay memorias pero no summary, CTA "Generar síntesis" con un click.
- **Aparece en N proyectos**: chips con status y count de memorias compartidas.
- **Aparece junto a**: chips de co-ocurrencias (color dot por tipo de entidad).
- **N memorias**: timeline lista con fuente, fecha y contenido.

**`/entities`** (lista) ahora ordena por `interaction_count desc` en lugar de alfabético — las personas/organizaciones más importantes salen primero. Usa la columna nativa en vez de recontar manualmente.

---

## Decisiones técnicas

1. **Triggers en DB > lógica en aplicación**: `interaction_count` y `summary_stale` se mantienen vía PG triggers. Ningún endpoint puede olvidarse de actualizar el contador. Esto es robusto frente a importadores futuros, scripts manuales o cualquier path que enlace memorias.
2. **`rolling_summary` text + `summary_payload` jsonb**: redundancia consciente. El text simple permite queries SQL ("entidades sin summary", "entidades con summary que mencionan X"). El payload jsonb guarda la estructura rica sin requerir nueva migración cada vez que el prompt evoluciona.
3. **Threshold `interaction_count >= 2` en el cron**: las entidades con 1 sola mención se refrescan solo on-demand. Razón: cuesta dinero generar un summary de Sonnet para "una persona que mencionaste una vez de pasada". El user puede forzar refresh manual si le interesa.
4. **`open_threads` como bullets, no como tareas**: no creé un sistema de tracking de "tareas pendientes con X" porque ya tenemos el feed proactivo + next-steps por proyecto. Los `open_threads` aquí son observaciones cualitativas ("Tienes pendiente confirmarle si vendrá al evento de marzo"), no items accionables formales. Si en el futuro se quieren convertir en pasos, se puede.
5. **Co-ocurrencia vía RPC SQL**: la consulta tiene un self-join sobre `memory_entities`. Hacerla en SQL devuelve resultados ordenados en una sola query. Si lo hiciera en TypeScript necesitaría traer todas las memorias y agregar — más lento y más data en el wire.
6. **Estados vacíos explícitos**: la diferencia entre "0 memorias" y "N memorias pero summary aún no generado" se resuelve con el CTA. Antes del Sprint 6 una entidad con 5 memorias y sin summary se veía igual que una nueva. Ahora el user entiende qué pasa.
7. **`summary_stale` no es timestamps**: usar boolean en lugar de "compare last_seen_at vs updated_at" porque triggers la setean a true cuando hace falta. El cron solo mira `WHERE summary_stale = true`. Más simple y barato de indexar.

---

## Cómo probarlo

Tras aplicar la migración Sprint 6:

### Smoke test 1 — Backfill histórico

```sql
-- Después de aplicar la migración, verificar:
select count(*) from entities where interaction_count > 0;     -- debería ser > 0
select count(*) from entities where summary_stale = true;      -- las pendientes de refresh
```

Si tienes entidades pre-existentes con muchas memorias y sin summary, llamar al cron:

```bash
curl -X POST https://<tu-dominio>/api/cron/refresh-summaries \
  -H "Authorization: Bearer <CRON_SECRET>"
```

Respuesta debería listar entidades refreshed con su confidence.

### Smoke test 2 — Refresh manual UI

1. Ir a `/entities` → click en una entidad con muchas interacciones (ej. Alfonso si lo tienes).
2. Si tiene summary previo, click ↻ → debería regenerar en ~10s mostrando spinner.
3. Si no tiene summary aún, el card muestra CTA "Generar síntesis". Click → genera.
4. Verificar que aparecen key_facts, highlights y open_threads correctamente.

### Smoke test 3 — Auto-stale después de captura

1. Anotar la fecha de `rolling_summary_updated_at` de una entidad (vista en su ficha como "hace Xh").
2. En el chat principal, capturar una memoria que mencione esa entidad ("Alfonso me ha dicho que...").
3. Verificar en SQL:

```sql
select id, name, summary_stale, interaction_count, last_seen_at
from entities where name ilike '%alfonso%';
```

- `summary_stale = true` (el trigger lo marcó)
- `interaction_count` incrementado en 1
- `last_seen_at` actualizado a now()

4. Ejecutar el cron → debería refrescar y volver a `summary_stale = false`.

### Smoke test 4 — Co-occurrence

En la ficha de una persona que aparezca en varias memorias compartidas con otras personas, verificar que aparece la sección "Aparece junto a" con chips clicables que navegan a otras entidades.

---

## Inspección SQL útil

```sql
-- Top 10 personas más mencionadas
select name, interaction_count, rolling_summary_updated_at
from entities
where entity_type = 'person'
order by interaction_count desc
limit 10;

-- Entidades con summary pero confianza baja (poco soporte)
select
  name,
  entity_type,
  interaction_count,
  (summary_payload->>'confidence')::float as conf
from entities
where summary_payload is not null
  and (summary_payload->>'confidence')::float < 0.5
order by conf;

-- Red de Alfonso
select * from entity_cooccurrence(
  (select id from entities where name = 'Alfonso Muñoz' limit 1),
  10
);

-- Cuánto cuesta el cron en una pasada típica
-- (suma de memories_considered de últimas 24h)
select sum((summary_payload->>'memories_considered')::int)
from entities
where rolling_summary_updated_at > now() - interval '24 hours';
```

---

## Pendiente / Sprint 7+

- **Panel "¿Qué pendiente con X?"** dentro de la ficha de persona, equivalente al NextStepsPanel pero para entidades. Pregunta tipo "¿Qué tengo que tratar la próxima vez con Alfonso?".
- **Comparativa entre entidades**: "qué une a Alfonso y Jose María en mis memorias".
- **Streaming del refresh**: cuando el summary tarda 10s, mostrar el texto generándose progresivamente vía SSE.
- **Sprint 7 original**: resúmenes periódicos vía cron + email (use case #4 del podcast).
- **Búsqueda dentro de la red cercana**: "memorias donde aparecen Alfonso Y Polonia".

---

## Checklist de cierre Sprint 6

- [ ] Migración `20260522000004_sprint6_entity_summaries.sql` aplicada en Supabase.
- [ ] `select count(*) from entities where interaction_count > 0` devuelve número correcto tras backfill.
- [ ] Crear una memoria con `select interaction_count, summary_stale from entities where id = '<id>'` confirma trigger funciona.
- [ ] `/entities` ordena por interacciones (las más activas primero).
- [ ] `/entities/[id]` muestra hero, card de síntesis y secciones de proyectos/co-ocurrencias/memorias.
- [ ] Botón ↻ regenera el summary en <15s con spinner visible.
- [ ] CTA "Generar síntesis" funciona en entidades sin summary previo.
- [ ] Key facts y highlights se muestran cuando el LLM los provee.
- [ ] Co-occurrence chips navegan a la entidad correspondiente.
- [ ] Cron extendido refresca tanto proyectos como entidades.
