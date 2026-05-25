# Sprint 3 — Asistente proactivo (use case #1 LIVE)

**Use case desbloqueado**: #1 — el asistente proactivo de proyectos.
**Bonus**: dashboard `/feed` que sintetiza qué merece atención esta semana.

---

## Qué se ha implementado

### Núcleo

| Módulo | Archivo | Función |
|---|---|---|
| Generador de pasos | `src/lib/projects/next-steps.ts` | Agrega proyecto + rolling_summary + memorias + entidades + pregunta opcional → LLM Sonnet 4.6 → 3-7 next steps estructurados |
| Generador de feed | `src/lib/projects/feed.ts` | Agrega todos los proyectos activos del usuario + métricas → LLM Sonnet 4.6 → feed prioritizado |
| Prompts | `src/lib/projects/prompts.ts` | `NEXT_STEPS_PROMPT` (proyecto) + `FEED_PROMPT` (transversal) |

### API Routes

| Endpoint | Función |
|---|---|
| `POST /api/projects/[slug]/next-steps` | Genera/regenera pasos. Body opcional `{ question }` para preguntas específicas |
| `GET /api/feed` | Genera el feed proactivo agregado |

### UI

| Pieza | Archivo | Comportamiento |
|---|---|---|
| `NextStepsPanel` | `src/components/projects/NextStepsPanel.tsx` | Client component que se embebe en `/projects/[slug]`. Input opcional de pregunta + botón "Generar pasos". Renderiza pasos numerados con `effort`, `rationale`, `depends_on` y bloqueadores |
| Página `/feed` | `src/app/feed/page.tsx` | Dashboard agrupado por prioridad (Ahora / Esta semana / Pronto). Cada item tiene categoría con glyph + chips a proyectos/entidades referenciados |
| Header chat | `src/app/page.tsx` | Nuevo botón ◈ que va al feed, destacado con halo violeta |

### Detalle del schema de respuesta

**`POST /api/projects/[slug]/next-steps`**:
```ts
{
  context_quality: 'rich' | 'moderate' | 'thin',
  headline: string,
  steps: Array<{
    action: string,                       // verbo en infinitivo
    rationale: string,
    effort: 'quick' | 'medium' | 'deep',
    depends_on: number[] | null           // índices 0-based
  }>,
  blocking_questions: string[],
  confidence: number,
  generated_at: string,
  model_used: string,
  user_question: string | null
}
```

**`GET /api/feed`**:
```ts
{
  summary: string,                        // 2-3 frases del momento del usuario
  items: Array<{
    title: string,
    detail: string,
    priority: 'now' | 'this_week' | 'soon',
    category: 'decision' | 'action' | 'communication' | 'review' | 'hygiene',
    related_project_slugs: string[],
    related_entity_names: string[]
  }>,
  stale_projects: string[],
  confidence: number,
  generated_at: string,
  model_used: string,
  projects_considered: number
}
```

---

## Flujo de uso

### A) ¿Qué hago ahora? por proyecto

```
[Usuario abre /projects/clavis]
  ↓
[Página carga datos del proyecto + memorias asociadas + rolling_summary]
  ↓
[NextStepsPanel visible con botón "Generar pasos"]
  ↓
[Usuario click → POST /api/projects/clavis/next-steps]
  ↓
generateNextSteps():
  ├─ Carga proyecto + 30 memorias activas + 12 entidades co-ocurrentes
  ├─ Construye prompt con todo el contexto
  ├─ LLM Sonnet 4.6 (tier deep, temp 0.4)
  └─ Devuelve JSON estructurado
  ↓
[UI renderiza con animación staggered:
  - Headline grande
  - Quality + confidence
  - Pasos numerados con effort/rationale/depends_on
  - Preguntas bloqueadoras si las hay]
```

### B) Feed proactivo agregado

```
[Usuario abre /feed]
  ↓
GET /api/feed
  ↓
generateFeed():
  ├─ Carga ≤18 proyectos activos con rolling_summary
  ├─ Calcula métricas por proyecto (memorias activas, dias_sin_actividad)
  ├─ Construye prompt con todo el panorama
  ├─ LLM Sonnet 4.6 (tier deep)
  └─ Devuelve feed prioritizado
  ↓
[UI renderiza:
  - Summary del momento del usuario
  - Sección "Ahora" (rojo, pulsante) si hay items
  - Sección "Esta semana" (azul)
  - Sección "Pronto" (gris)
  - "Proyectos stale" al final si los hay
  - Cada item: categoría + título + detalle + tags clickables]
```

---

## Decisiones técnicas notables

1. **Doble nivel de "siguientes pasos"**:
   - `projects.rolling_next_steps` (Sprint 2): es un campo TEXT regenerado automáticamente con el rolling_summary, sirve como base estable.
   - `next-steps` endpoint (Sprint 3): es interactivo, regenera bajo demanda, acepta preguntas, devuelve estructura rica con effort y dependencias.

   La distinción importa: el primero es "estado pasivo del proyecto", el segundo es "asistente activo respondiéndome ahora".

2. **No se persiste el resultado del next-steps interactivo**: cada generación es efímera. Esto es deliberado:
   - Permite que el usuario pregunte cosas distintas sin contaminar el estado del proyecto.
   - Si quiere "fijar" un paso, lo hace capturándolo como memoria normal.
   - Evita complejidad de versionado.

3. **`effort` y `depends_on` en el output**: el LLM clasifica cada paso en `quick`/`medium`/`deep` y declara dependencias entre pasos. Esto convierte una lista plana en algo que se puede atacar por orden lógico, no por orden de prioridad.

4. **Feed no es solo concatenar `rolling_next_steps`**: el prompt obliga al LLM a sintetizar y detectar patrones cruzados (mismo bloqueo en varios proyectos, persona recurrente). Si solo quisieras agregar literalmente, harías un `select` y listo — la síntesis añade valor por encima.

5. **Categorización del feed**: 5 categorías (decision/action/communication/review/hygiene) con glyphs y colores distintos. Permite escanear visualmente y saber qué tipo de tarea espera al usuario antes de leer el detalle.

6. **Loading state cuidado**: el feed tarda (10-20s con Sonnet 4.6). En vez de un spinner pelado, hay un halo difuso con texto pulsante: "Sintetizando lo que merece tu atención…". UX > UI técnico.

7. **`max_tokens` deliberadamente alto** (1500 next-steps, 2000 feed): Sonnet con razonamiento + JSON estructurado consume más output del esperado. Limitarlo cortaría items finales y romperia el JSON.

---

## Cómo probar Sprint 3

1. Tener Sprint 0-2 funcionando con varias memorias y al menos 2-3 proyectos con rolling_summary generado.
2. Abrir `/projects/[slug]` de uno. Verás el `NextStepsPanel` debajo del título.
3. Click en **Generar pasos**: 10-15s después aparecen 3-7 pasos numerados con effort y rationale.
4. Probar pregunta específica: escribir "¿Cómo desbloqueo X?" en el input y regenerar.
5. Ir a `/feed`. Loading ~15-25s. Verás summary, secciones por prioridad, items con tags clickables.
6. Click en un tag de proyecto → navega al detalle. Click en regenerar (↻ del header) → recarga.

### Inspección útil

```sql
-- Coste agregado de tokens en Sprint 3 (si lo trackeas en source_metadata)
select count(*), avg(processing_ms)::int
from ingestion_log
where decision_model ilike '%sonnet%';
```

---

## Cierre del Sprint 3: cache + completions

Dos piezas añadidas para cerrar el sprint de forma utilizable día a día:

### Cache del feed (`src/lib/projects/feed-cache.ts`)

`GET /api/feed` ahora consulta primero `feed_cache` (tabla nueva, ver migración Sprint 3 más abajo). TTL por defecto: **1 hora**. La respuesta incluye `from_cache: boolean` y `cached_age_minutes`. El botón ↻ en `/feed` hace `?refresh=1` para forzar regeneración con Sonnet.

Esto convierte el feed en algo consultable barato. Sin cache, cada vuelta al feed costaba ~$0.05 en Sonnet; con cache, lo mismo cuesta una query a Postgres.

**Invalidación automática**: tras completar un paso (siguiente apartado), el cache se invalida → la próxima carga refleja el cambio.

### Marcar pasos como hechos (`POST /api/projects/[slug]/next-steps/complete`)

Cuando el usuario marca un paso como `Hecho`, `Parcial` o `Descartado`, el endpoint:

1. Crea una memoria automática (`source_type='text'`) describiendo qué pasó (verbo + paso + notas del user).
2. La pasa por el pipeline normal (clasificador + extracción de proyectos/entidades).
3. Fuerza el enlace memory ↔ project (por si el clasificador no lo detectó).
4. Bumpea `last_activity_at` del proyecto.
5. Invalida el `feed_cache` del usuario.

Resultado: el grafo se alimenta solo. La próxima vez que el usuario pida "¿qué hago ahora?" en ese proyecto, el contexto ya incluye lo que acaba de completar y los pasos propuestos serán distintos.

### Migración SQL Sprint 3

`supabase_migrations/20260522000002_sprint3_feed_cache.sql`:

- Tabla `feed_cache (user_id PK, payload jsonb, generated_at, expires_at, model_used, projects_considered)` con RLS.
- Función `cleanup_expired_feed_cache()` para limpiar cache caducado (opcional, vía cron).

### UI actualizada del NextStepsPanel

Cada paso ahora tiene tres botones en la parte inferior:

- **Hecho** (verde, con glow) → status `done`
- **Parcial** (ámbar) → status `partial`
- **Descartar** (apagado, con tachado) → status `skipped`

Al pulsar, aparece un diálogo inline con textarea opcional ("¿algún detalle que añadir?") antes de confirmar. Tras guardar, el paso queda visualmente tachado con badge de status y el resto del panel se mantiene para que puedas marcar varios. Para ver pasos refrescados con el nuevo contexto, pulsas **Regenerar**.

---

## Pendiente / posibles Sprint 4+

- **Streaming SSE de respuestas LLM** para que los pasos aparezcan progresivamente en vez de esperar 15s a tener todo.
- **Notificaciones PWA push** cuando hay items `now` en el feed que llevan mucho sin atender.
- **Vista compacta del feed en el header del chat** (badge con conteo de items `now`).
- **Filtros del feed**: solo decisiones, solo comunicación, por proyecto.
- **Comparativas temporales**: cómo evolucionó el feed en las últimas semanas.
- **Importadores y vaciado histórico** (Sprint 4 original): entrevistador conversacional + Gmail/Drive/WhatsApp.

---

## Checklist de cierre Sprint 3

- [ ] Migración `20260522000002_sprint3_feed_cache.sql` aplicada en Supabase.
- [ ] `NextStepsPanel` aparece en `/projects/[slug]` y devuelve pasos en <30s.
- [ ] Preguntas específicas en el input modifican la respuesta (priorización distinta).
- [ ] Pasos muestran effort, rationale, y depends_on cuando aplica.
- [ ] `blocking_questions` aparecen en bloque amarillo si el LLM las identifica.
- [ ] **Botones Hecho/Parcial/Descartar funcionan y crean memoria automática**.
- [ ] **Tras completar un paso, regenerar muestra propuestas que reflejan el progreso**.
- [ ] `/feed` carga y muestra al menos 1 sección con items.
- [ ] **La segunda carga de `/feed` viene del cache (response incluye `from_cache: true`)**.
- [ ] Items del feed enlazan correctamente a `/projects/[slug]` cuando hay `related_project_slugs`.
- [ ] `stale_projects` aparece al final si hay proyectos inactivos.
- [ ] Botón ↻ del feed regenera correctamente (`from_cache: false`).
- [ ] Link ◈ en header del chat va al feed.
