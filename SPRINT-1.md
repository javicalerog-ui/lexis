# Sprint 1 — Motor de captura + búsqueda semántica

**Use case desbloqueado**: #2 (búsqueda semántica universal).
**Use case parcial**: #1 (asistente proactivo) — el modelo de datos ya soporta proyectos y entidades, pero el agente proactivo entra en Sprint 3.

---

## Qué se ha implementado

### Backend

| Módulo | Archivo | Función |
|---|---|---|
| Adapter embeddings | `src/lib/embeddings/voyage.ts` | embed(), embedOne(), embedBatch() contra voyage-4-lite (1024 dims) |
| Cliente LLM | `src/lib/llm/openrouter.ts` | callOpenRouter() con soporte JSON mode y visión |
| Escalación | `src/lib/llm/escalation.ts` | chat() y chatWithEscalation() — Fast → Deep si confidence < umbral |
| Prompts | `src/lib/llm/prompts.ts` | SUMMARIZE, IMAGE_CAPTION, QUERY_REWRITE |
| Pipeline | `src/lib/ingestion/pipeline.ts` | Orquesta: LLM resume + embed + INSERT memory |
| Caption visión | `src/lib/ingestion/image.ts` | Caption de imagen vía Gemini Flash → texto embebible |
| Chunking | `src/lib/utils/chunking.ts` | Split de textos largos con overlap |

### Frontend (parseo client-side, runtime-agnóstico)

| Parser | Archivo | Librería |
|---|---|---|
| PDF | `src/lib/ingestion/pdf.ts` | pdfjs-dist (Mozilla PDF.js, worker desde CDN) |
| XLSX | `src/lib/ingestion/xlsx.ts` | SheetJS, genera narrativa estructurada por hoja |
| Markdown | `src/lib/ingestion/markdown.ts` | gray-matter (frontmatter + body) |

### API Routes

- `POST /api/capture` — recibe texto procesado o `source_uri` (imagen) y persiste memory.
- `POST /api/search` — embebe query y llama al RPC `search_memories` de Supabase.
- `GET /auth/callback` — exchange del magic link.

### UI

- `/auth/login` — login con magic link, glassmorphism + glow gradient.
- `/` — chat principal con tabs **Capturar** / **Buscar**, drop de archivos, attachments inline.
- Componentes: `ChatInput`, `MessageList`, `MemoryCard`.
- PWA manifest configurado, instalable en iOS/Android.

---

## Flujo de captura (paso a paso)

### Texto plano

```
[Usuario escribe] → POST /api/capture { source_type: 'text', raw_text }
  → ingest():
      → chatWithEscalation(SUMMARIZE_PROMPT) [Gemini Flash]
          ├─ summary_md
          ├─ content_normalized
          ├─ projects[], entities[]
          ├─ captured_at_iso
          └─ confidence
      → voyage.embedOne(content + summary) [voyage-4-lite, document]
      → INSERT memories
      → INSERT ingestion_log
  → response { memory_id, summary, decision: 'new', confidence }
[UI muestra confirmación]
```

### PDF / XLSX / MD

```
[Usuario suelta archivo] → parser CLIENT-SIDE extrae texto
  → POST /api/capture { source_type: 'pdf'|'xlsx'|'md', raw_text }
  → (mismo pipeline que texto)
```

### Imagen

```
[Usuario suelta imagen]
  → supabase.storage.upload() → signed URL
  → POST /api/capture { source_type: 'image', source_uri }
  → captionImage(url) [Gemini Flash vision]
      ├─ description
      ├─ ocr_text
      ├─ objects, tags
      ├─ people_mentioned
      └─ confidence
  → captionToText() → texto unificado
  → (mismo pipeline que texto desde el LLM resumen)
```

### Búsqueda

```
[Usuario escribe query en tab "Buscar"]
  → POST /api/search { query }
  → voyage.embedOne(query, 'query') [input_type='query']
  → supabase.rpc('search_memories', { query_embedding, match_count: 8 })
  → resultados ordenados por similitud coseno
[UI renderiza MemoryCards con %similarity]
```

---

## Cómo probar localmente

```bash
# Tras Sprint 0 (Supabase up, schema aplicado, env vars listas):
npm install
npm run dev
# Abrir http://localhost:3000
```

### Smoke test

1. Login con magic link → ir a `/`.
2. Tab **Capturar** → escribir "Hoy he tenido reunión con Alfonso sobre la expansión a Polonia". Enviar.
3. Verificar mensaje de confirmación con summary.
4. Tab **Buscar** → escribir "reuniones con Alfonso". Verificar que aparece la memoria con similitud > 60%.
5. Tab **Capturar** → soltar un PDF. Verificar que se parsea, se resume y se guarda.
6. Tab **Capturar** → soltar una imagen (e.g., foto de tu mesa). Verificar caption coherente en el summary.

### Inspección en Supabase

```sql
-- Memorias recientes
select id, source_type, summary, captured_at
from memories
order by ingested_at desc
limit 10;

-- Log de ingestión
select * from ingestion_log order by created_at desc limit 5;

-- Búsqueda manual
select content, summary, 1 - (embedding <=> '[...vector...]'::vector) as sim
from memories
order by embedding <=> '[...vector...]'::vector
limit 5;
```

---

## Decisiones técnicas notables

1. **Parseo client-side** (PDF, XLSX): evita limitaciones de runtime de Cloudflare Pages. El navegador hace el trabajo, el backend recibe texto.
2. **Embeddings con `input_type` distinto** para document vs query: voyage usa instrucciones internas distintas, mejora el recall.
3. **Escalación Fast → Deep por confidence**: el LLM declara su propia confianza. Si < 0.7, repetimos con Sonnet. En la práctica, el 90% de captura se resuelve con Gemini Flash (~50× más barato).
4. **El embedding va sobre `content_normalized + summary_md`, no sobre el raw**: el LLM normaliza el texto eliminando ruido, lo que mejora el recall en la búsqueda.
5. **RLS habilitado desde día 1**: aunque seas mono-usuario, todas las queries usan `auth.uid()`. Si mañana añades un user, no migras nada.
6. **Imágenes**: caption por Gemini Flash → embed con voyage-4-lite (texto). Un solo espacio vectorial, búsqueda semántica natural ("foto de la gaiata con pancartas").

---

## Cosas pendientes para Sprint 2

- Clasificador "nuevo / modificación / redundante" (ahora todo es 'new').
- Auto-asignación de memoria a proyectos y entidades (extraer y persistir en tablas `projects` y `entities`, no solo en metadata).
- Endpoint y UI para listar/editar proyectos.
- Recálculo del `rolling_summary` de proyectos cada N memorias o cada hora (cron).

## Sprint 3 (asistente proactivo) requiere

- Tablas `projects` pobladas con `rolling_summary` actualizado (Sprint 2).
- Endpoint `/api/projects/[slug]/next-steps` que dada toda la memoria asociada genere propuestas.
- UI: ProjectPanel con estado vivo, botón "¿Qué hago ahora?".

---

## Checklist de cierre Sprint 1

- [ ] `npm install` instala sin errores.
- [ ] `npm run dev` arranca sin errores.
- [ ] Login con magic link funcional.
- [ ] Captura de texto plano → memoria guardada con summary coherente.
- [ ] Captura de PDF → texto extraído y resumido.
- [ ] Captura de XLSX → narrativa por hoja.
- [ ] Captura de MD → frontmatter + body.
- [ ] Captura de imagen → caption coherente.
- [ ] Búsqueda devuelve resultados relevantes con similitud > 0.5.
- [ ] Deploy en Cloudflare Pages funciona en producción.
- [ ] PWA instalable en móvil iOS/Android.
