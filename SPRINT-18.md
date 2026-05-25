# Sprint 18 — Acciones contextuales (bandeja + quick replies + voz)

## Qué entrega

- **Schema `agent_actions`**: cada disparo de regla deja una fila aquí con `quick_replies` y `open_route`.
- **Página `/inbox`** con tabs pendiente/todas, badge contador en el header del chat principal.
- **Quick replies tappeables** con efectos directos sobre el grafo: cerrar eventos, archivar proyectos, etc.
- **FAB de respuesta por voz** dentro del inbox para responder libremente a cualquier acción.
- **Deep links desde push**: tocar el push abre `/inbox?action=ID&quick=X` y dispara la quick reply automáticamente.

## Archivos

```
supabase_migrations/20260523000004_sprint18_agent_actions.sql
src/app/api/agent-actions/route.ts                # GET list con badge count
src/app/api/agent-actions/[id]/respond/route.ts   # POST respond (efectos en grafo), DELETE dismiss
src/app/inbox/page.tsx + .module.css
src/components/inbox/InboxClient.tsx + .module.css
src/components/inbox/InboxBadge.tsx + .module.css # icono header + badge polling
src/app/page.tsx                                   # añade InboxBadge al header del chat principal
src/components/voice/FloatingVoiceCapture.tsx     # excluye /inbox y /settings/{notifications,proactive-rules}
```

## Lifecycle de una `agent_action`

```
   regla dispara
        │
        ▼
   pending  ──┐── tap quick reply ─→  responded  (+ efectos en grafo)
              │
              ├── tap "Descartar" ─→  dismissed
              │
              └── expires_at pasa ─→  expired (mantenimiento al consultar inbox)
```

`responded_at` se setea al cambiar; `response` jsonb guarda `{ action, payload, voice_transcript, side_effects }`.

## Quick replies — efectos

| action | efecto |
|---|---|
| `mark_event_done` | events.status='done', responded_at=now |
| `snooze_event_1d/2d/7d` | events.due_at += N días, mantiene 'pending' |
| `cancel_event` | events.status='cancelled' |
| `project_archive` | projects.status='archived' |
| `project_snooze_14d` | refresca projects.updated_at (no salta dormant otra vez) |
| `project_keep_active` | refresca projects.updated_at, sin más cambios |
| `voice_note` | ingest del transcript como memoria nueva linkeada a la action |
| `dismiss` | solo cierra la action |
| `open_route` | abre la `open_route` de la action y marca como responded |

Cada efecto está en `lib/proactive/executors.ts` (cuando dispara la regla) y `app/api/agent-actions/[id]/respond/route.ts` (cuando el user responde).

## Bandeja UI

- **Tab "Pendientes"** (default) con badge count.
- **Tab "Todas"** muestra historial completo.
- Tarjetas con: título, prompt, fecha relativa, expires_at, status badge.
- Quick replies como botones en fila. El primero (índice 0) destaca con el gradiente accent.
- Botón **◉** abre input de voz contextual a esa action.
- Botón "Descartar" suave para cerrar sin acción.

## Respuesta por voz dentro del inbox

Cuando tocas el botón **◉** de una action concreta:
1. Aparece un `VoiceRecorder` con `reviewBeforeSubmit=true` (puedes revisar transcript antes de enviar).
2. Al confirmar → POST con `action='voice_note'`, `voice_transcript=...`.
3. El endpoint pasa el transcript al pipeline de ingest normal (con metadata `agent_action_id` y `rule_id` para trazabilidad).
4. La memoria resultante queda enlazada en `response.side_effects.voice_memory_id`.

Esto cierra el loop: Lexis te pregunta, tú le respondes hablando, y la respuesta se convierte en una memoria buscable.

## Deep links desde push

Push notifications llevan `data.url = /inbox?action=ID`. Al tocar:
- SW (`notificationclick`) abre la URL.
- `InboxClient` detecta `?action=ID` en searchParams → scroll a la card.

Para quick replies del navegador (`actions: [{ action, title }]` en `showNotification`):
- SW concatena `?action=ID&quick=X` al abrir.
- `InboxClient` detecta `?quick=X` → ejecuta automáticamente la quick reply matching → limpia la URL.

Esto permite responder "Hecho" sin abrir realmente la app (en navegadores que soportan actions, e.g. Chrome desktop).

## Badge en el header

Componente `InboxBadge` con icono `⊞` insertado entre `/digest` (✉) y `/connectors` (⇲).

- Polling cada 60s + refresh al volver focus.
- Endpoint `GET /api/agent-actions?status=pending&limit=1` devuelve `pending_count` exacto via `count: 'exact', head: true`.
- Badge oculto cuando count=0.
- Render como pill flotante en esquina superior derecha del icono, max display "99+".

## Mantenimiento automático

`GET /api/agent-actions` marca como `expired` las que tienen `expires_at < now` y siguen pending. Ligero, sin necesidad de cron extra.

## Variables de entorno

Ninguna nueva.
