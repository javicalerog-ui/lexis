# Sprint 16 — Push notifications PWA

## Qué entrega

- **Schema `push_subscriptions`** por dispositivo del usuario.
- **VAPID** server-side con `web-push`.
- **Service worker** ampliado con listeners `push` y `notificationclick`.
- **Helper `sendPush`** que respeta quiet hours, tipos deshabilitados, y limpia subscriptions caducadas (404/410).
- **UI `/settings/notifications`**: toggles globales, tipos, anticipación, silencio nocturno, gestión de dispositivos.
- **API `/api/user-settings`** para timezone, quiet hours, write_to_primary, tipos.

## Archivos

```
supabase_migrations/20260523000002_sprint16_push.sql
src/lib/push/send.ts                              # sendPush con web-push
src/app/api/push/subscribe/route.ts               # POST/DELETE/GET endpoint
src/app/api/user-settings/route.ts                # GET/PATCH settings
public/sw.js                                       # listeners push + notificationclick
src/app/settings/notifications/page.tsx + .module.css
src/components/settings/NotificationsSettingsClient.tsx + .module.css
package.json                                       # añadidas web-push + @types/web-push
```

## VAPID — generar las claves

```bash
npx web-push generate-vapid-keys
```

Genera `publicKey` y `privateKey`. Cópialas a `.env.local`:

```
VAPID_PUBLIC_KEY=BNb...                          # base64-url, ~85 chars
VAPID_PRIVATE_KEY=xWa...                          # base64-url, ~43 chars
VAPID_SUBJECT=mailto:tu@email.com                 # debe ser mailto: o https://
```

En producción (Cloudflare Pages → Settings → Environment variables) añade las tres.

## Quiet hours

Configurable en `/settings/notifications`. Por defecto `22:00 → 08:00` en `user_settings.timezone` (Europe/Madrid).

Cuando un `sendPush` se ejecuta dentro de la ventana:
- Para sends normales: se descarta silenciosamente (no se acumula).
- Para sends con `ignore_quiet_hours: true`: se entrega igualmente (reservado para errores críticos del sistema).

La franja puede cruzar medianoche (22→08 funciona correctamente).

## Tipos de aviso

Cinco buckets en `push_types_enabled` (jsonb en `user_settings`):

| key | qué cubre |
|---|---|
| `deadlines` | fechas límite extraídas de capturas |
| `meetings` | aviso pre-reunión (Sprint 17 preset 3) |
| `follow_ups` | compromisos del user (Sprint 17 preset 4) |
| `reminders` | recordatorios neutros |
| `reviews` | repaso viernes, captura Outlook, proyectos durmiendo (presets 1, 2, 5) |

Cada `sendPush` lleva `type_key` que se chequea contra estos toggles.

## Anticipación (offsets)

`push_offsets_minutes` es un array de minutos antes del evento. Default `[1440, 60, 15]` (24h, 1h, 15min). Sprint 17 lo consume para programar avisos previos cuando hay eventos con `due_at` conocido.

## Flujo de suscripción del navegador

1. User entra `/settings/notifications` → ve "Conectar este dispositivo".
2. Click → `Notification.requestPermission()` → user acepta.
3. `serviceWorker.ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC_KEY })`.
4. El objeto `PushSubscription` se manda a `POST /api/push/subscribe` con `endpoint`, `keys.p256dh`, `keys.auth`, `user_agent`.
5. Server hace upsert sobre (user_id, endpoint).
6. Quitar dispositivo → `DELETE /api/push/subscribe` + `subscription.unsubscribe()` en cliente.

## Cleanup automático

Cuando `web-push` devuelve **404** o **410** (subscription dead), el helper la borra de la DB. Para otros errores, guarda el `last_error` para diagnóstico sin borrarla.

## Cron entries actualizados

Cloudflare Pages → Crons:

```
*/10 * * * *   /api/cron/connectors     # Sprint 10
0    * * * *   /api/cron/digest         # Sprint 7
0    * * * *   /api/cron/refresh-summaries  # Sprint 6
*/5  * * * *   /api/cron/proactive      # Sprint 17 (NUEVO)
```

Todos protegidos con `Authorization: Bearer ${CRON_SECRET}`.
