# Sprint 14 — Google Calendar (read + write)

## Qué entrega

- **Adapter `calendar`** que sincroniza eventos de Google Calendar como memorias y eventos estructurados.
- **Escritura** de eventos en Google Calendar con safety net "Lexis · Borradores".
- **Infraestructura `user_settings`** (timezone, quiet hours, draft_calendar_id) que es base de los Sprints 14-18.

## Archivos

```
supabase_migrations/20260523000000_sprint14_user_settings.sql
src/lib/time/userTime.ts              # helpers timezone, cron, quiet hours, localToUtc
src/lib/google-calendar/write.ts      # createEvent, updateEvent, deleteEvent, ensureDraftCalendar, listCalendars
src/lib/connectors/adapters/calendar.ts  # adapter completo con syncToken incremental
src/app/api/oauth/google/start/route.ts  # añade intents 'calendar' y 'full_workspace'
src/app/api/credentials/google/calendars/route.ts  # GET lista de calendarios para la UI
src/lib/connectors/registry.ts        # registra calendarAdapter
src/lib/connectors/runner.ts          # upsertCalendarEvent: poblar tabla events desde calendar items
src/components/connectors/NewConnectorClient.tsx  # OAUTH_INTENT['calendar']
```

## Decisiones clave

### Sync incremental con syncToken
Primer run: lista eventos en ventana `[now-30d, now+90d]` por cada `calendar_id` configurado, captura `nextSyncToken`. Subsiguientes runs usan solo el syncToken (delta puro). Si Google devuelve 410 Gone (caduca tras semanas sin uso), fallback automático a primer run.

### Safety net "Lexis · Borradores"
Cualquier evento que Lexis crea por defecto va a un calendario propio llamado **"Lexis · Borradores"** que se autocrea la primera vez (`ensureDraftCalendar`). Esto evita que un error del LLM o un evento mal extraído contamine tu calendario principal. Puedes mover el evento manualmente cuando lo revises.

Si quieres que Lexis escriba directamente al calendario primario, activa `write_to_primary` en `user_settings`. Todo evento creado por Lexis lleva la marca `extendedProperties.private.created_by_lexis='true'` para auditoría.

### Calendarios múltiples
El config del connector acepta una lista de IDs (uno por línea) en el campo `calendar_ids`. Tras autorizar el OAuth, llama `GET /api/credentials/google/calendars` para que la UI muestre los disponibles.

### Eventos del Calendar van DOS sitios
1. **Tabla `memories`** (vía ingest normal del runner) con todo el contenido en texto plano para búsqueda semántica.
2. **Tabla `events`** (vía `upsertCalendarEvent` directo) con campos estructurados (due_at, type, attendees) para reglas proactivas y feed.

El extractor LLM de Sprint 15 detecta `origin=connector_calendar` y se salta esos memories para no duplicar.

## OAuth · scopes nuevos

| intent | scopes añadidos |
|---|---|
| `calendar` | `openid`, `email`, `https://www.googleapis.com/auth/calendar` |
| `full_workspace` | calendar + drive + gmail |

El scope `calendar` (no `calendar.readonly`) es **obligatorio** porque necesitamos crear el calendario "Lexis · Borradores". Asegúrate de añadir este scope al consent screen en Google Cloud Console antes de autorizar.

## Outlook → Calendar (sincronización corporativa)

Lexis no se conecta a Microsoft 365 directamente. Para acceder a tu agenda corporativa de Outlook tienes dos rutas complementarias:

1. **Subscribe ICS** (configuración 5 min): en Outlook Web App, Calendar → Settings → "Publish calendars" → publicar como ICS. En Google Calendar → "+ Add other calendars" → "From URL" → pegar el ICS. Tarda 6-24h en sincronizar la primera vez pero después es automático.
2. **Captura por foto** (Sprint 15): sacar foto al Outlook desde el FAB de Lexis, el extractor de visión saca los eventos y los crea en Google Calendar tras tu confirmación.

## Variables de entorno requeridas

Ninguna nueva. Reutiliza `GOOGLE_OAUTH_CLIENT_ID` y `GOOGLE_OAUTH_CLIENT_SECRET` del Sprint 11.
