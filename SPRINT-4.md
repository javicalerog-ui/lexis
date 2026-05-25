# Sprint 4 — Vaciado histórico

**Use case desbloqueado**: arrancar Lexis con datos reales. Hasta ahora, Lexis solo capturaba a partir de "hoy". Sprint 4 te da dos vías para meter de un golpe lo que ya tienes esparcido:

1. **Entrevistador conversacional** — sesión guiada donde Lexis te pregunta y cada respuesta tuya se convierte en memoria. Útil para volcar lo que tienes en la cabeza pero no en archivos.
2. **Importador masivo** — drop de múltiples archivos (PDF, XLSX, MD, TXT, imágenes, WhatsApp export) que pasan por el pipeline completo (clasificador, proyectos, entidades).

---

## Qué se ha implementado

### Entrevistador

| Módulo | Archivo | Función |
|---|---|---|
| Prompts | `src/lib/interview/prompts.ts` | `OPENING_PROMPT`, `INTERVIEWER_PROMPT`, `SESSION_TITLE_PROMPT` |
| Orchestrator | `src/lib/interview/orchestrator.ts` | `openingQuestion()`, `nextQuestion()`, `ingestUserResponse()`, `generateSessionTitle()` |

**Cómo funciona el ciclo**:

```
[Usuario inicia sesión con foco: open | project | entity]
   ↓
openingQuestion() lee el grafo (proyectos top, entidades, foco si lo hay)
   → Sonnet 4.6 genera 1ª pregunta abierta pero específica
   → Persistido en interview_messages como assistant
   ↓
[Usuario responde]
   ↓
POST /api/interview/[id]
   ├─ Persistir mensaje user
   ├─ ingestUserResponse() → llama al pipeline normal (clasificador, attach)
   │    → crea memoria; si foco era proyecto/entidad, garantiza el enlace
   │    → invalida feed_cache
   ├─ nextQuestion() con historial completo + grafo
   │    → Sonnet decide siguiente pregunta o saturated=true
   └─ Persistir nueva pregunta (si no saturada) + actualizar contadores
   ↓
[Loop hasta que user cierra o LLM marca saturated]
   ↓
POST /api/interview/[id]/complete
   → generateSessionTitle() con tier fast → título 1 línea
   → status='completed'
```

### Importador masivo

| Módulo | Archivo | Función |
|---|---|---|
| WhatsApp parser | `src/lib/import/whatsapp.ts` | Soporta los 3 formatos comunes de export, parsea timestamps, agrupa en bloques de 30 mensajes |
| Batch API | `src/app/api/import/route.ts` | Recibe array de items pre-parseados (cliente parseó) y los procesa secuencialmente |

**Por qué parsing client-side**: Cloudflare Pages corre Edge runtime; pdf-parse y xlsx server-side dan problemas. El cliente extrae el texto (con pdfjs-dist, SheetJS, gray-matter, el parser de WhatsApp), y manda al backend solo el texto + metadatos.

**Por qué procesamiento secuencial server-side**: el clasificador necesita ver memorias previas para detectar duplicados. Concurrencia → race conditions donde dos memorias casi idénticas se crean simultáneamente sin verse.

### API Routes

| Endpoint | Función |
|---|---|
| `POST /api/interview/start` | Crea sesión + primera pregunta |
| `GET /api/interview/[id]` | Sesión + mensajes ordenados |
| `POST /api/interview/[id]` | Mete respuesta → memoria → siguiente pregunta |
| `POST /api/interview/[id]/complete` | Cierra y genera título |
| `POST /api/import` | Ingesta masiva de hasta 50 items por request |

### UI

| Ruta | Pantalla |
|---|---|
| `/interview` | Lista de sesiones (activas + cerradas) + `SessionStarter` con tabs (Exploratoria / Proyecto / Entidad) |
| `/interview/[id]` | Conversación con `InterviewChat`: burbujas asimétricas, badge "memoria capturada ✓" en respuestas del user, indicador `nuevo tema` cuando topic_shift, spinner mientras Sonnet razona, botón "Cerrar sesión" |
| `/import` | Drop zone grande + tabla de archivos con status individual (pending / parsing / queued / ok / failed) + resumen final con stats (memorias nuevas, modificaciones, redundantes, errores) |
| Header del chat | Dos botones más: ※ (Entrevista) y ⤓ (Importar) |

### Migración SQL Sprint 4

`supabase_migrations/20260522000003_sprint4_interviews.sql`:

- Enums: `interview_focus_type`, `interview_status`, `interview_role`.
- Tabla `interview_sessions(id, user_id, status, focus_type, focus_project_id?, focus_entity_id?, title, questions_asked, memories_generated, saturation_signal, created_at, last_message_at, completed_at)`.
- Tabla `interview_messages(id, session_id, role, content, memory_id?, reasoning, topic_shift, created_at)`.
- RLS habilitado en ambas tablas.

---

## Decisiones técnicas notables

1. **Foco de sesión**: tres modos `open / project / entity`. El opening prompt usa el foco para producir una pregunta más relevante. Las respuestas en sesiones con foco se enlazan automáticamente al proyecto o entidad incluso si el clasificador no lo detecta.
2. **Saturación detectada por el LLM**: en cada turno, el interviewer declara `saturated: boolean`. Cuando es `true`, no se persiste nueva pregunta y la UI muestra una nota "He extraído bastante". El usuario puede seguir manualmente o cerrar.
3. **Histórico recortado**: solo los últimos 20 turnos van al prompt. Suficiente para mantener coherencia local sin reventar el context window en sesiones largas.
4. **Optimistic UI** en `InterviewChat`: el turno del user aparece inmediatamente con un id temporal; cuando el server responde, se reemplaza con el id real. Si falla, se devuelve el draft al input.
5. **WhatsApp parser conservador**: agrupa en bloques de 30 mensajes (no 1 memoria por mensaje — sería ruido). Cada bloque va al pipeline normal, que detecta personas, fechas y proyectos del contenido.
6. **Bloques imagen suben antes**: la página de import sube imágenes a `lexis-raw` y manda la signed URL al backend para que la captioneé. El resto de tipos pasa texto extraído.
7. **El import fuerza invalidación del feed**: importar mucha información puede mover proyectos y crear entidades; el `/feed` debe reflejarlo cuando el user vuelva.
8. **Sesión vs memoria**: cada respuesta del usuario genera UNA memoria (sin importar la longitud). El pipeline decide si es nueva, modificación o redundante. Saber qué genera qué se trackea con `interview_messages.memory_id`.

---

## Cómo probarlo

Tras aplicar la migración Sprint 4:

### Smoke test entrevista

1. Ir a `/interview` → click "Empezar" con foco "Exploratoria".
2. Responder la primera pregunta con algo real.
3. Verificar que aparece badge "memoria capturada ✓" en tu respuesta y que la siguiente pregunta del assistant tiene sentido a partir de lo que dijiste.
4. Tras 4-5 turnos, cerrar la sesión. Verificar título generado.
5. Ir a `/projects` o `/entities` → ver que tus respuestas crearon proyectos/entidades nuevos.

### Smoke test entrevista con foco

1. `/interview` → pestaña "Sobre un proyecto" → selecciona uno.
2. Verificar que la primera pregunta hace referencia explícita al proyecto (no es genérica).
3. Responder. Verificar que las memorias quedan enlazadas a ese proyecto en su `/projects/[slug]`.

### Smoke test import

1. Tener algunos archivos preparados: PDFs cortos, una hoja XLSX, un MD, un export de WhatsApp.
2. `/import` → arrastrar todos.
3. Click "Importar".
4. Ver el status individual avanzar (parsing → queued → ok/failed).
5. Resumen al final con stats. Las nuevas memorias deben aparecer en proyectos relevantes y `/feed`.

### Inspección SQL

```sql
-- Sesiones del usuario
select
  s.id, s.status, s.focus_type, s.questions_asked, s.memories_generated,
  s.title, s.created_at
from interview_sessions s
order by s.last_message_at desc nulls last;

-- Mensajes de una sesión
select role, content, memory_id, topic_shift
from interview_messages
where session_id = '<uuid>'
order by created_at;

-- Memorias creadas vía entrevista
select id, summary, source_metadata->>'interview_session_id' as session_id
from memories
where source_metadata->>'origin' = 'interview'
order by ingested_at desc;

-- Memorias creadas vía batch import
select count(*), source_metadata->>'batch_size' as batch_size
from memories
where source_metadata->>'origin' = 'batch_import'
group by batch_size;
```

---

## Cierre del Sprint 4: resumen estructurado + progreso de import

Dos piezas que faltaban para que Sprint 4 fuera realmente utilizable:

### Resumen estructurado al cerrar sesión

`POST /api/interview/[id]/complete` ahora genera DOS cosas en lugar de solo el título:

1. **Título 1 línea** (Gemini Flash, barato).
2. **Resumen estructurado** (Sonnet 4.6, calidad) con:
   - `overview` — 2-3 párrafos describiendo de qué fue la sesión, no recapitulación literal.
   - `highlights[]` — 3-5 bullets con lo más sustantivo (decisiones, descubrimientos, bloqueos identificados).
   - `connections[]` — 0-3 observaciones cruzadas (patrones entre temas/personas/proyectos). Vacío si nada destaca.
   - `new_projects[]` y `new_entities[]` — calculados desde DB: lo que el grafo no tenía antes de la sesión.

Migración SQL: `supabase_migrations/20260522000004_sprint4_session_summaries.sql` añade columna `summary jsonb` a `interview_sessions`.

**Render en UI**:
- `/interview/[id]` cuando `status='completed'` muestra el bloque "Resumen de la sesión" debajo del chat: overview, highlights numerados con barras de color, conexiones, y chips clicables a los proyectos/entidades nuevos.
- `/interview` (lista) muestra preview del overview debajo del título y conteo de proyectos nuevos.

Si la generación del summary falla, la sesión se cierra igual y `summary` queda `null` (defensivo).

### Barra de progreso del import

`/import` ahora muestra barra de progreso global con `n/total procesados` durante el import. La lógica de chunks de 20 items ya estaba; lo que faltaba era la visualización agregada para que el usuario sepa cuánto queda.

El status por archivo individual (parsing → queued → ok/failed) sigue funcionando como antes.

---

## Pendiente / Sprint 5+

- **Captura por voz** (Sprint 5 original): Whisper en local (Ollama) o via OpenRouter para transcribir; usable también dentro del entrevistador.
- **MCP Gmail / Drive / Notion**: importadores que tiran de los conectores que ya tienes en Claude.
- **Streaming SSE** de respuestas LLM para que las preguntas de la entrevista aparezcan progresivamente.
- **Editar/reabrir sesiones cerradas** (ahora son inmutables).

---

## Checklist de cierre Sprint 4

- [ ] Migración `20260522000003_sprint4_interviews.sql` aplicada en Supabase.
- [ ] Migración `20260522000004_sprint4_session_summaries.sql` aplicada.
- [ ] `/interview` carga, muestra el starter y lista vacía (al principio).
- [ ] Crear sesión exploratoria devuelve primera pregunta en <10s.
- [ ] Responder en `/interview/[id]` crea memoria y devuelve siguiente pregunta.
- [ ] Badge "memoria capturada ✓" visible tras cada respuesta del user.
- [ ] Sesión con foco "Proyecto" enlaza memorias automáticamente al proyecto seleccionado.
- [ ] `topic_shift=true` aparece como "nuevo tema" en la UI.
- [ ] **Al cerrar sesión, se genera summary estructurado con overview, highlights y nuevos del grafo.**
- [ ] **La sesión cerrada muestra el bloque "Resumen de la sesión" debajo del chat.**
- [ ] **La lista `/interview` muestra preview del overview en cada sesión completada.**
- [ ] `/import` permite drop múltiple y muestra status por archivo.
- [ ] **Barra de progreso global visible durante el import con `n/total procesados`.**
- [ ] WhatsApp .txt se parsea correctamente (bloques con timestamps).
- [ ] Resumen final del import muestra stats correctos.
- [ ] Tras un import, `/feed` regenera (cache invalidado).
- [ ] Header del chat muestra los nuevos botones ※ (Entrevista) y ⤓ (Importar).
