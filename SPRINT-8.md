# Sprint 8 — Búsqueda con filtros + Timeline + Dashboard

**Pulido para uso diario**. Lexis tiene los 4 use cases originales cerrados. Sprint 8 convierte el grafo en algo navegable de verdad: la búsqueda gana filtros ricos, hay vista timeline para recorrer cronológicamente, y un dashboard que muestra la salud del segundo cerebro de un vistazo.

Sin migraciones de schema — sólo RPCs nuevos. Tu data existente está intacta.

---

## Qué se ha implementado

### Migración (`supabase_migrations/20260522000006_sprint8_search_metrics.sql`)

Tres RPCs nuevos sobre tablas existentes:

| RPC | Para qué |
|---|---|
| `search_memories_filtered(user_id, query_embedding?, ...)` | Búsqueda semántica con filtros múltiples: arrays de project_ids, entity_ids, source_types, origins, rango de fechas. Si no hay query_embedding, hace browse cronológico |
| `user_activity_buckets(user_id, granularity, from, to)` | Serie temporal: agrupa memorias por día/semana/mes para el chart del dashboard |
| `user_metrics_snapshot(user_id)` | Snapshot JSON único con todas las métricas principales (total memorias/proyectos/entidades, by_source_type, memorias_last_7d, etc.) |

### Búsqueda con filtros (`src/lib/search/filters.ts` + endpoint reescrito)

**Tipos compartidos** con Zod: `Filters`, `SearchSchema`, `TimelineSchema`. Helper `enrichMemories(supabase, rows)` que añade los `projects[]` y `entities[]` enlazados a cada memoria en dos queries batch.

**`/api/search` reescrito** para usar el RPC nuevo. Mantiene retrocompatibilidad con `{query, match_count}` simple. Acepta opcionalmente:

```typescript
{
  query?: string,                     // sin query = browse cronológico
  match_count?: number,
  min_similarity?: number,
  filters?: {
    project_ids?: string[],
    entity_ids?: string[],
    source_types?: SourceType[],
    origins?: string[],
    date_from?: ISO,
    date_to?: ISO,
  }
}
```

Devuelve `{ query, filters_applied, count, results: EnrichedMemory[] }`.

### Endpoint Timeline (`/api/timeline`)

`POST` con `{filters, cursor?, limit?}`. Paginación cursor-based sobre `captured_at desc`. Pide `limit + 1` para saber si hay siguiente página. Devuelve `{ count, has_more, next_cursor, items: EnrichedMemory[] }`.

### Endpoint Metrics (`/api/metrics`)

`GET` con query params `?granularity=day|week|month` y `?days=N`. Devuelve snapshot + buckets de actividad + top proyectos (últimos 60d) + top entidades (interaction_count global).

### Componente reusable `SearchFilters`

Diseñado para vivir tanto en una página dedicada como inline en cualquier vista. UI:

- **Toolbar** siempre visible: toggle "Filtros" (con badge contador), chips de filtros activos directos (proyectos + entidades, primeros 3), botón "limpiar todo".
- **Panel expandible** en grid responsivo con secciones:
  - **Periodo**: presets pill (Todo / 7d / 30d / 90d / 1y) en una barra deslizante con estado activo.
  - **Proyectos**: search inline + lista checkable con scroll. Multi-select.
  - **Entidades**: igual pero con tag de tipo (person/org/...). Multi-select.
  - **Tipo de fuente**: chips con glyph distintivo (T, ◉, ▢, ▤, ▦, ↳, ⌘).
  - **Origen**: chips para capture / interview / batch_import / next_step_completion.

Estética coherente con el resto: glassmorphism, gradiente accent en estados activos, violet para entidades, mono para counts/badges.

### Página `/timeline`

Server component carga proyectos + entidades para los filtros. Delega a `TimelineClient` (client component) que maneja:

- Filtros (vía `SearchFilters`).
- Fetch + recarga al cambiar filtros (con `JSON.stringify` como dep).
- Infinite scroll con IntersectionObserver y sentinel + rootMargin 300px.
- **Agrupado visual por día** con etiquetas relativas: "Hoy", "Ayer", "lunes" (si <7d), o "lun, 12 mayo".
- Cada item muestra: hora · source · origin (si lo hay) · texto · chips a proyectos/entidades enlazadas.
- Estados: loading (dots bouncing), end-of-history ("· fin del histórico ·"), empty con mensaje, error.

### Página `/dashboard`

Server component que hace todas las queries en paralelo y delega charts a client components con SVG inline.

**Layout** (4 zonas):

1. **Hero metrics grid**: 4 cards con métricas principales. La de "Memorias totales" tiene halo radial accent y número en gradiente.
2. **Velocity row**: 3 cards mostrando semana actual, mes actual, promedio semanal de las últimas 13 semanas.
3. **Activity chart**: gráfico de barras SVG inline con 13 semanas. Cada barra muestra el count encima (si > 0), grid lines de eje Y, etiquetas X cada 2 semanas, gradiente accent que pasa a violet en hover.
4. **Two-col + full**: distribución por source_type (barras horizontales con % share), top proyectos por actividad reciente (barras horizontales con accent), top entidades por interaction_count (barras horizontales con violet y dot de color por tipo).

Animaciones escalonadas (`animation-delay` 0 / 60 / 120 / 180ms) para que las secciones aparezcan en cascada al cargar.

### Charts (SVG puro, sin librerías)

- **`ActivityChart.tsx`**: gráfico de barras con viewBox responsivo, gradiente con `<defs>`, hover swap a gradiente violet, tooltips nativos vía `<title>`, eje Y con grid lines y labels mono. Para 13 semanas.
- **`SourceDistribution.tsx`**: barras horizontales con track + fill animado, count + % share, glyph distintivo por tipo en cuadrado mono.

Ambos generan ~5KB de markup, sin dependencias.

### Header actualizado

Añadidos dos accesos: ⌬ (Dashboard) y ⌖ (Timeline). El header ahora tiene 8 botones de navegación. En móvil hace scroll horizontal silencioso (overflow-x auto + scrollbar oculto) en lugar de wrap o overflow visible.

---

## Decisiones técnicas

1. **Sin migración de schema**: el RPC `search_memories_filtered` recibe arrays y los aplica con `= any(...)`. No tocamos tablas. Si quieres revertir, basta con `drop function`.

2. **Filtros opcionales todos**: cualquier campo de `Filters` puede omitirse. Esto permite reusar el mismo endpoint para "browse sin filtros" (timeline) y "search con todos los filtros" (search avanzada).

3. **Cursor-based pagination, no offset**: para timeline. Es estable si se insertan memorias mientras paginas (offset-based crearía duplicados o gaps). El cursor es el `captured_at` del último item visto.

4. **Charts en SVG inline**: nada de Recharts/Chart.js/D3. Para 13 barras y 7 distribuciones no compensa cargar 100KB+ de JS. Plus: SVG inline = SSR, sin layout shift al hidratar.

5. **Server components para datos, client components para UI dinámica**: `/timeline` y `/dashboard` cargan en el server. Filtros y paginación viven en client. Esto reduce JS al mínimo y aprovecha streaming SSR de Next.

6. **Agrupado por día en timeline**: hecho en cliente sobre los items ya cargados, no en SQL. Razón: el agrupado depende del huso horario del usuario; mejor que JS lo haga con `slice(0,10)` sobre el ISO local. Si tuvieras 100k memorias se pasaría a SQL, para uso normal (cientos/miles) está bien.

7. **`enrichMemories` separado del RPC**: el RPC devuelve fields planos de `memories`. Después una capa TS hace dos queries batch (`memory_projects` + `memory_entities`) para todos los IDs juntos y los stitches. Esto da N+2 queries por página (no N+1·dependencias), que es óptimo para los <50 items por página.

8. **`SearchFilters` componente puro**: no llama a APIs, no tiene estado de fetch. Solo `value` + `onChange`. El parent decide qué hacer con el cambio. Esto lo hace reusable en `/timeline`, `/dashboard` (futuro), `/projects/[slug]` (filtrar memorias del proyecto), etc.

9. **Scroll horizontal en header**: pragmático. 8 botones + logout no caben en móvil. Wrap rompe el layout sticky. Scroll horizontal silencioso (sin scrollbar visible) es lo que hacen Slack/Discord/Linear.

---

## Cómo probarlo

Tras aplicar la migración Sprint 8:

### Smoke test 1 — Búsqueda con filtros

1. `/` modo Buscar → query "Alfonso". Resultados como antes.
2. Hacer cURL directo al endpoint con filtros:

```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -H "Cookie: ..." \
  -d '{
    "query": "decisión",
    "filters": {
      "source_types": ["voice", "text"],
      "date_from": "2026-04-01T00:00:00Z"
    }
  }' | jq
```

3. Verificar que `count` cambia con/sin filtros y que `results[].source_type` solo incluye los filtrados.

### Smoke test 2 — Timeline

1. Ir a `/timeline` (icono ⌖ en header).
2. Sin filtros: ver memorias agrupadas por día, paginar haciendo scroll hasta el final.
3. Activar filtros: seleccionar 2 proyectos. Lista se reduce. El badge del toggle muestra "2".
4. Combinar con periodo "30d" y source "Voz". Verificar combinaciones funcionan.
5. Click en chip ✦ proyecto → navega a `/projects/[slug]`.

### Smoke test 3 — Dashboard

1. Ir a `/dashboard` (icono ⌬ en header).
2. Verificar:
   - Hero metrics con números reales del grafo.
   - Velocity row mostrando captura semanal/mensual/promedio.
   - Activity chart con 13 semanas (algunas vacías al inicio si tu cuenta es nueva).
   - Distribución por source_type con porcentajes.
   - Top 8 proyectos del último 60d.
   - Top 8 entidades por `interaction_count` global.
3. Click en cualquier barra → navega al recurso.

### Inspección SQL

```sql
-- Test directo del RPC con filtros
select id, summary, similarity
from search_memories_filtered(
  '<tu-user-id>'::uuid,
  null,                                 -- sin embedding = browse
  10,
  0,
  null,                                 -- project_ids
  null,                                 -- entity_ids
  array['voice', 'text'],               -- source_types
  null,
  '2026-04-01'::timestamptz,
  null
);

-- Métricas snapshot
select user_metrics_snapshot('<tu-user-id>'::uuid);

-- Actividad mensual último año
select * from user_activity_buckets(
  '<tu-user-id>'::uuid,
  'month',
  now() - interval '1 year'
);
```

---

## Inspección útil para uso diario

```sql
-- Qué proyectos no he tocado en 90 días pero siguen activos
select p.name, p.slug, max(m.captured_at) as last
from projects p
left join memory_projects mp on mp.project_id = p.id
left join memories m on m.id = mp.memory_id and m.status = 'active'
where p.user_id = '<uid>' and p.status = 'active'
group by p.id, p.name, p.slug
having max(m.captured_at) is null or max(m.captured_at) < now() - interval '90 days'
order by last asc nulls first;

-- Top 10 días con más actividad de mi vida en Lexis
select date_trunc('day', captured_at)::date as day, count(*)
from memories
where user_id = '<uid>' and status = 'active'
group by day
order by count desc
limit 10;
```

---

## Pendiente / posibles Sprint 9+

- **Filtros en `/projects/[slug]` y `/entities/[id]`**: las memorias listadas ahora son todas; permitir filtrar por source_type, fechas, origen.
- **Búsqueda con highlights**: marcar las palabras del query en los resultados (Postgres `ts_headline` + el embedding combinados).
- **Comparativas temporales en dashboard**: "esta semana vs media de las últimas 4", "evolución mensual del peso de cada proyecto".
- **Export del grafo**: dump JSON/CSV del set actual de memorias con filtros aplicados.
- **PWA push notifications**: requiere VAPID keys + service worker + push gateway. Para items "now" del feed o digests recién llegados.
- **Streaming SSE para next-steps y digest preview**: las generaciones que tardan 15-30s con Sonnet.
- **MCP importers**: Gmail/Drive/Notion vía los conectores que tienes en Claude. Endpoint que hace fetch al MCP server con tu key de Anthropic y pasa al pipeline.

---

## Checklist de cierre Sprint 8

- [ ] Migración `20260522000006_sprint8_search_metrics.sql` aplicada.
- [ ] `/timeline` carga, muestra memorias agrupadas por día, scroll infinito funciona.
- [ ] `SearchFilters` panel expande con presets de periodo, listas multi-select, source chips, origin chips.
- [ ] Chip de filtro activo se quita al click. Botón "limpiar" resetea todo.
- [ ] `/dashboard` muestra métricas reales del grafo.
- [ ] Activity chart muestra barras con counts encima, gradiente accent → violet en hover.
- [ ] Distribución por source_type con porcentajes correctos.
- [ ] Top proyectos / entidades con barras animadas en carga.
- [ ] Header con 8 botones de navegación, scroll horizontal silencioso en móvil.
- [ ] Búsqueda en `/` (chat principal) sigue funcionando con el endpoint reescrito (retrocompatibilidad).
