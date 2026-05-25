# Sprint 15 — Extractor de eventos (texto + imagen)

## Qué entrega

- **Schema `events`**: deadlines, meetings, follow-ups, reminders y recurrentes con due_at en UTC, status y enlaces al grafo (memoria/proyecto/entidad).
- **Extractor LLM** que detecta menciones temporales en cualquier captura (voz, texto, imagen) y crea filas en `events`.
- **Pipeline especializado imagen → eventos** para fotos de Outlook / Google Calendar / agendas.
- **UI `/events/preview`**: revisar eventos detectados antes de crearlos en Google Calendar.
- **FAB con modo "Foto del calendario"** además del modo voz.
- **Sección "Próximos eventos"** en `/feed`.

## Archivos

```
supabase_migrations/20260523000001_sprint15_events.sql
src/lib/events/extractor.ts                       # extractor texto → events
src/lib/events/imageExtractor.ts                  # extractor visión especializado para calendario
src/app/api/events/route.ts                       # GET list + POST crear desde drafts
src/app/api/events/[id]/route.ts                  # PATCH mark_done/snooze/cancel/reopen/edit, DELETE
src/app/api/events/from-image/route.ts            # POST extrae eventos de imagen
src/lib/ingestion/pipeline.ts                     # paso 6.b extractor no-bloqueante
src/app/events/preview/page.tsx + .module.css
src/components/events/EventsPreviewClient.tsx + .module.css
src/components/voice/FloatingVoiceCapture.tsx     # reescrito con modos voz/calendar_image
src/components/voice/FloatingVoiceCapture.module.css  # estilos modeTabs/uploadBtn
src/app/feed/page.tsx                             # sub-component UpcomingEventsSection
```

## Schema `events`

| campo | tipo | notas |
|---|---|---|
| `due_at` | timestamptz | UTC. Para all_day, hora local 00:00 convertida. |
| `ends_at` | timestamptz | nullable, para meetings con duración. |
| `all_day` | boolean | si true, ignora la hora; due_at marca solo el día. |
| `type` | enum | deadline / meeting / follow_up / reminder / recurring |
| `status` | enum | pending / done / snoozed / cancelled / expired |
| `source` | enum | calendar / voice / image / text / manual |
| `linked_memory_id`, `linked_project_id`, `linked_entity_id` | uuid | enlaces al grafo |
| `external_event_id`, `external_calendar_id` | text | si vino de Google Calendar |
| `confidence` | float | 0-1; los del extractor LLM bajo |
| `metadata` | jsonb | attendees, location, snoozed_history, etc. |

RPC `upcoming_events(user_id, horizon_days, limit)` para el feed y reglas proactivas.

## Extractor LLM (texto)

Se inyecta como paso 6.b en `lib/ingestion/pipeline.ts`. No-bloqueante: si falla, el ingest sigue siendo exitoso.

**Anclado a:**
- `captured_at` de la memoria
- `timezone` del usuario (`user_settings`)

"El viernes" cuando dictas miércoles 22 mayo 2026 en Europe/Madrid = viernes 24 mayo 2026 a las 09:00 local (convertido a UTC).

**Ventana de aceptación (opción C):**
- Futuras: sin límite.
- Pasadas: solo hasta 7 días atrás (útil para follow-ups: "envié el lunes").
- Más allá: descartado, son menciones históricas.

**Filtros:**
- Texto < 40 chars: skip (probablemente no tiene fechas)
- `confidence` < 0.6: skip (el LLM ha asignado baja certeza)
- `origin=connector_calendar`: skip (esos eventos los crea el runner directamente)

## Extractor visión (imagen → eventos)

Pipeline distinto al captioner general (`lib/ingestion/image.ts`). Usa un prompt especializado (`CALENDAR_VISION_PROMPT`) que pide al modelo:
- Identificar si la imagen es realmente una vista de calendario.
- Para cada evento visible: title, date_local, start/end_time_local, attendees, location.
- View type: weekly/daily/monthly/list.

El cliente `EventsPreviewClient` resuelve `date_local + time_local` → UTC usando `localToUtc(...)` y la zona del user.

## Flujo de uso (foto del calendario)

1. Usuario abre FAB → tab "Foto del calendario" → sube/saca foto.
2. Imagen se sube a `lexis-raw/${user.id}/calendar-captures/${ts}.${ext}`.
3. Redirige a `/events/preview?image_url=...`.
4. Página llama `POST /api/events/from-image`, recibe drafts.
5. User revisa, edita (título, tipo), selecciona los que quiere.
6. Toggle "Crear también en Google Calendar" decide si pasa también por `createEvent` del Sprint 14 (default: ON, va al calendario "Lexis · Borradores").
7. `POST /api/events` con todos los drafts seleccionados → inserts en `events` + opcional GCal.

## Edge cases manejados

- **Imagen no es calendario** → `is_calendar_view: false` con mensaje al user.
- **Eventos con baja confianza** (< 0.5) → descartados; entre 0.5 y 0.7 → checkbox por defecto OFF.
- **All-day vs hora específica** → diferentes formatos para Google Calendar API (`date` vs `dateTime`).
- **Attendees con texto libre** → solo se mandan a GCal los que parecen email (regex).
- **GCal create falla** → se inserta en `events` igualmente para no perder el draft; se reporta en `errors`.
