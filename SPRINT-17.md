# Sprint 17 — Agente proactivo programado

## Qué entrega

- **Schema `proactive_rules`** con kind (preset/custom), trigger (cron/event), action_payload.
- **5 reglas preset** autocreadas al primer acceso a `/settings/proactive-rules`.
- **Cron `/api/cron/proactive`** cada 5 min que evalúa todas las reglas habilitadas.
- **Executors** específicos por action_type (capture_request, friday_review, pre_meeting_context, followup_check, dormant_project_check, push_simple).
- **UI `/settings/proactive-rules`** para toggle + creación de custom.
- **Detector LLM de incongruencias** que avisa antes de crear una regla custom que solape con las existentes, y deja al user decidir.

## Archivos

```
supabase_migrations/20260523000003_sprint17_proactive_rules.sql
src/lib/proactive/presets.ts                     # definición canónica de las 5 reglas
src/lib/proactive/manage.ts                      # ensurePresetsForUser + detectConflicts (LLM)
src/lib/proactive/executors.ts                   # 6 executors por action_type
src/app/api/proactive-rules/route.ts             # GET list / POST create (con check conflicto)
src/app/api/proactive-rules/[id]/route.ts        # PATCH toggle/edit, DELETE (solo custom)
src/app/api/cron/proactive/route.ts              # scheduler cada 5min
src/app/settings/proactive-rules/page.tsx + .module.css
src/components/settings/ProactiveRulesClient.tsx + .module.css
```

## Las 5 reglas preset

| key | trigger | acción |
|---|---|---|
| `outlook_capture_weekly` | cron `30 7 * * 1` (lun 7:30) | Push "Saca foto a tu vista semanal de Outlook" → tap abre PWA en modo captura calendario |
| `friday_review` | cron `0 17 * * 5` (vie 17:00) | Push con resumen de deadlines/compromisos próxima semana |
| `pre_meeting_context` | event `meeting_in_window` (30min antes) | Push con contexto de entidad/proyecto vinculado al evento |
| `commitment_followup` | event `event_due_today` type=follow_up | Push con quick replies: Hecho / Posponer 2d / Ya no aplica |
| `dormant_project` | cron `0 9 * * 1` (lun 9:00) | Push con quick replies: **Sigue activo** / Archivar / Posponer 14d |

**Idempotencia de creación**: `ensurePresetsForUser` busca cuáles faltan por `preset_key` (única constraint), crea solo esas. Si el user deshabilita una preset (no la borra; los presets no se pueden borrar), no se vuelve a recrear hasta que la fila desaparezca.

## Cron scheduler

`GET /api/cron/proactive` cada 5 min:

1. Carga todas las reglas con `enabled=true`.
2. Para cada regla:
   - **Cron**: evalúa `cronMatchesNow` con la zona del user. También hace backcheck hasta 5 min atrás por si el scheduler se desfasó.
   - **Event**: pasa siempre al executor; este decide si toca disparar (puede devolver `fired: false, reason: 'no_meetings_in_window'`).
3. Si dispara: ejecuta acción, crea fila `agent_actions` (Sprint 18), manda push, actualiza `last_fired_at` y `next_due_at`.
4. **Anti-spam para event-based**: si `last_fired_at` es < 5 min, skip.

Protegido con `Bearer ${CRON_SECRET}`.

## Detector de incongruencias (LLM)

Cuando el user crea una regla custom desde `/settings/proactive-rules`:

```
POST /api/proactive-rules
  → carga reglas existentes activas
  → llama LLM (Gemini Flash con escalation a Sonnet) con prompt CONFLICT_SYSTEM_PROMPT
  → LLM devuelve JSON estricto: { has_conflict, conflicting_rule_id, conflict_kind, explanation, confidence }
```

Si `has_conflict=true` y `confidence >= 0.6` → respuesta 409 con todo el contexto.

Si `has_conflict=false` → crea la regla directamente.

### Tipos de conflicto

- `duplicate`: la nueva hace exactamente lo mismo en el mismo momento.
- `overlap`: solapamiento de avisos redundantes.
- `shadowing`: una hace todo lo que hace la otra y más → una de las dos queda inútil.

### Pantalla de decisión

Cuando el server responde 409, la UI muestra un diálogo modal con:
- **Tu nueva regla** (resumen + trigger en code).
- **Regla en conflicto** (resumen + trigger + etiqueta "preset" / "tu custom").
- **Explicación del LLM** sobre por qué solapan.
- **3 botones:**
  1. **Quedarme con la mía** → POST con `?force=true&disable_preset_id=...` → crea la nueva + deshabilita la conflictiva.
  2. **Quedarme con la existente** → descarta la nueva, cierra el modal.
  3. **Mantener ambas** → POST con `?force=true` → crea la nueva sin tocar la existente.

### Robustez

- Si el LLM inventa un `conflicting_rule_id` que no existe en la lista → se descarta el conflicto (defensa).
- Si el LLM falla por timeout/error → se permite la creación (no se bloquea al user por infra).
- El umbral 0.6 es deliberado: preferimos crear con avisos extra a falsear conflictos.

## Custom rules — qué se puede definir desde UI

Trigger:
- **Cron**: campo libre 5 campos.
- **Event**: dropdown con `event_due_today`, `meeting_in_window`, `no_capture_for_days`.

Action: por simplicidad, todas las customs usan `action_type=push_simple` con `title`, `body` configurables. El executor `executePushSimple` crea la fila en `agent_actions` y manda push.

Esto cubre el 80% de casos de uso. Para acciones más complejas (consultas al grafo, quick replies dinámicas) hay que añadir un `action_type` nuevo en `executors.ts` y referenciarlo manualmente en la regla (no UI, pero soportado).

## Variables de entorno

Ninguna nueva. Reutiliza `OPENROUTER_API_KEY` para el detector LLM.

`CRON_SECRET` (ya existente del Sprint 7) protege el endpoint.
