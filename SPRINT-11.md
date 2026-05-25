# Sprint 11 — Gmail Connector con OAuth Google

Primer conector específico sobre el engine del Sprint 10. Trae:

1. **OAuth 2.0 Google reutilizable** (lo usará Drive en Sprint 12 sin cambios).
2. **Refresh on-demand** de access_tokens con margen anti-expiración.
3. **Adapter Gmail** con sincronización incremental via History API.
4. **Flow OAuth integrado en la UI** de alta: selector de cuentas existentes o nueva autorización en un solo paso.

Sin migraciones SQL — todo encaja en las tablas `connector_credentials` y `connectors` del Sprint 10.

---

## Setup previo: Google Cloud Console

**Tienes que hacer esto antes de que funcione en local.** Una vez.

1. Ir a [console.cloud.google.com](https://console.cloud.google.com), crear un proyecto (o usar uno existente). Yo lo llamaría "lexis".

2. **APIs & Services → Library**: habilitar:
   - **Gmail API**
   - **Google People API** (necesaria para el `userinfo` endpoint)

3. **APIs & Services → OAuth consent screen**:
   - User type: **External** (en producción es lo que toca; si el verification screen te molesta, mientras desarrollas puedes mantenerlo en "Testing" y añadirte como test user).
   - App name: "Lexis"
   - Support email: tu correo
   - Logo: opcional
   - **Scopes**: añadir:
     - `openid`
     - `email`
     - `https://www.googleapis.com/auth/gmail.readonly`
     - `https://www.googleapis.com/auth/drive.readonly` (preparado para Sprint 12)
   - **Test users**: añadirte mientras esté en modo Testing.

4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**
   - Name: "Lexis web"
   - **Authorized redirect URIs**:
     - `http://localhost:3000/api/oauth/google/callback` (dev)
     - `https://lexis.tu-dominio.com/api/oauth/google/callback` (producción)

5. Anotar **Client ID** y **Client secret**. Configurar en `.env.local`:

```bash
GOOGLE_OAUTH_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-xxxxxxxxxx
NEXT_PUBLIC_APP_URL=http://localhost:3000          # o tu dominio en producción
OAUTH_STATE_SECRET=<32-bytes-random-hex>           # cualquier string fuerte
```

Para generar `OAUTH_STATE_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

En **Cloudflare Pages producción**: añadir las cuatro variables en el dashboard.

---

## Qué se ha implementado

### OAuth helpers (`src/lib/oauth/`)

**`google.ts`** — primitivas del provider:
- `buildAuthUrl({ scopes, state, login_hint })` — genera URL para redirect a Google.
- `exchangeCodeForTokens(code)` — POST a `oauth2.googleapis.com/token`.
- `refreshAccessToken(refresh_token)` — refresh flow.
- `fetchUserInfo(access_token)` — obtiene email del user.

Configurado con `access_type=offline` + `prompt=consent` para garantizar siempre refresh_token (Google lo omite si el user ya consintió antes).

**`state.ts`** — CSRF state firmado:
- `signState({ user_id, intent })` — HMAC-SHA256 con `OAUTH_STATE_SECRET`, payload base64url.
- `verifyState(signed)` — valida firma con `timingSafeEqual` y deserializa.
- Cookie `lexis_oauth_state` httpOnly + Secure + SameSite=Lax, 10 minutos TTL.
- En el callback: la cookie debe coincidir con el state recibido (double-submit), y la firma debe validar.

**`refresh.ts`** — `refreshIfNeeded(supabase, credentials)`:
- Margen de 5 minutos antes de expiración.
- Si no necesita refresh, devuelve la credential tal cual.
- Si refresca, persiste el nuevo access_token + expires_at + scopes (merge si Google manda otros).
- Manejo de respuestas sin `refresh_token` (no rotated): mantiene el anterior.

El **runner** (Sprint 10) ahora llama a `refreshIfNeeded` antes de pasar credentials al adapter. Cualquier adapter futuro recibe credentials siempre frescas.

### Endpoints OAuth

**`GET /api/oauth/google/start`**:
- Query: `intent=gmail|drive|gmail_drive`, `next`, `connector_name`, `reuse_credentials_id`.
- Mapea intent → scopes apropiados (mapa en el archivo).
- Genera state firmado con todos esos campos en el payload.
- Setea cookie y redirige a `https://accounts.google.com/o/oauth2/v2/auth?...`.

**`GET /api/oauth/google/callback`**:
1. Valida cookie == query state.
2. Verifica firma.
3. Comprueba sesión Supabase coincide con user_id del state.
4. Intercambia code → tokens.
5. Fetch userinfo (email).
6. **Persistencia idempotente**: si ya existe una credential con `(user_id, provider='google', account_identifier=email)`, hace **merge de scopes** y actualiza tokens. Si no, INSERT. Esto soluciona el caso "el user ya tenía Gmail y ahora añade Drive": una sola credential, scopes acumulados.
7. Redirige a `next?credentials_id=<id>&oauth_success=1`.

Si algo falla en cualquier paso, redirige a `/oauth/google/error` con código + detalle truncado.

**`GET /oauth/google/error`** — página standalone con catálogo de errores en español, detalle técnico colapsable, botones para reintentar.

### Endpoint credentials

**`GET /api/credentials`** — lista credentials del user. Filtros opcionales:
- `?provider=google`
- `?scopes=gmail.readonly,...` — filtra credentials que **incluyan todos** los scopes pedidos.

Sin tokens en la respuesta (solo metadata: provider, label, email, scopes, expires_at).

**`DELETE /api/credentials/[id]`** — borra la credential. Los connectors que la usaban quedan con `credentials_id=null` (FK con ON DELETE SET NULL del Sprint 10).

### Adapter Gmail (`src/lib/connectors/adapters/gmail.ts`)

**Config schema**:
- `query` (text, required, default `label:lexis-inbox`) — sintaxis Gmail search.
- `max_per_run` (number, default 25) — tope para no saturar bandejas grandes.
- `include_attachments` (boolean) — detección de adjuntos (no procesados todavía).

**Estrategia de sync**:

| State | Comportamiento |
|---|---|
| Primer run (`last_history_id` vacío) | `GET /messages?q=<query> newer_than:14d` con cap `max_per_run` |
| Subsiguientes | `GET /history?startHistoryId=<id>&historyTypes=messageAdded`, paginado hasta agotar o llegar al cap |
| History demasiado viejo (404/410) | Fallback: `GET /messages?q=<query>` sin filtro fecha |

Cada mensaje → fetch full content con `format=full` → mapeo a `ConnectorItem`:

- **external_id**: `gmail_<message_id>` → dedup del Sprint 10 evita duplicados aunque History reaparezca.
- **content**: `Asunto: <subj>\nDe: <from>\n\n<body>`. Cuerpo extraído del MIME, preferencia `text/plain`, fallback a `text/html` stripped.
- **source_type**: `text`.
- **source_uri**: enlace directo `https://mail.google.com/mail/u/0/#all/<id>`.
- **captured_at**: `internalDate` del mensaje (milisegundos).
- **metadata**: gmail_message_id, gmail_thread_id, gmail_label_ids, subject, from, to, date_header, snippet, has_attachments.

**Parsing MIME propio sin dependencias**:
- Walk recursivo de `payload.parts`.
- Decode base64url en cuerpos.
- Strip HTML básico (sin DOMPurify, sin regex catastrophic backtracking).
- Trunca contenido a 40k chars como safety.

### UI integrada (Sprint 10 reescrito)

`NewConnectorClient` ahora tiene **tres steps** en lugar de dos:

1. **`pick`** — grid de adapters. Sin cambios visibles.
2. **`oauth`** (nuevo, solo para adapters con `oauth_provider`):
   - Banner ámbar explicando la autorización requerida.
   - Si ya hay credentials del provider con los scopes necesarios: lista con cards (logo Google gradient, email, "N scopes · añadida X días"), click → avanzar a configure con `selectedCredentialsId`.
   - Botón "+ Conectar otra cuenta" debajo si quiere autorizar una distinta.
   - Si no hay credentials: botón único estilo Material "Conectar con Google".
3. **`configure`** — añade un **badge verde** "Cuenta conectada · email@x.com" en la parte superior cuando hay `credentials_id` seleccionado. El POST de creación lo incluye automáticamente.

**Detección del retorno OAuth**: cuando la URL incluye `?credentials_id=X&oauth_success=1`, el componente avanza directamente al step `configure` con esa credential preseleccionada y limpia los query params.

**Gmail aparece en el grid** (no en "Próximamente"). Drive sigue en "Próximamente" hasta Sprint 12.

### Cambio en el runner (Sprint 10)

Una línea: antes de pasar credentials al adapter, llama a `refreshIfNeeded`. El adapter siempre recibe access_token válido por al menos 5 minutos. Si el refresh falla, la excepción se propaga, el run queda en `failed` y el error queda en `last_error` del connector.

---

## Decisiones técnicas

1. **State con HMAC en cookie, no tabla en DB**: más simple, sin garbage collection. La cookie es httpOnly+Secure+SameSite=Lax. El TTL de 10 minutos es suficiente para cualquier flow OAuth normal.

2. **`include_granted_scopes=true`**: permite acumular scopes en sucesivos OAuth flows sin perder los anteriores. Útil cuando un user empieza con Gmail y después añade Drive.

3. **Idempotencia por `(user_id, provider, email)`**: añadir Drive a un user que ya tiene Gmail actualiza la misma credential. Una cuenta Google → una row, scopes acumulados. Esto se ve reflejado en la UI: el selector "Cuentas ya autorizadas" muestra una sola entrada con todos los scopes.

4. **Refresh con margen de 5 minutos**: balance entre evitar el 401 mid-request y no refrescar innecesariamente. Empíricamente Gmail tokens duran ~1h, así que refrescar 5min antes de expirar funciona bien.

5. **History API como sync principal, list como fallback**: History es eficiente (delta puro) pero Google solo guarda historia ~1 semana. Si el connector está pausado mucho tiempo, vuelve a list mode automáticamente. El user no se entera.

6. **Cap de 25 mensajes por run en defaults**: en bandejas con un filtro muy abierto (e.g. `label:inbox`), 25 mensajes/15min = 100/hora = 2400/día. Más que suficiente para no perder cosas y poco para no saturar.

7. **`newer_than:14d` solo en primer run**: si el user habilita un filtro que pillaría 10k mensajes históricos, el primer run no se atraganta. A partir del segundo, History es incremental puro.

8. **External_id = `gmail_<message_id>`**: Google garantiza que el message_id es único e inmutable por mensaje. Dedup del Sprint 10 lo usa directamente.

9. **Adjuntos detectados pero no procesados**: el flag `has_attachments` queda en metadata. Procesar adjuntos requiere descarga + parsing por tipo (PDF, image, doc) + posible storage. Se merece su propio Sprint cuando haga falta.

10. **OAuth a nivel de cuenta Google, no a nivel de connector**: por eso `credentials` es tabla separada. Permite "una cuenta sirve N connectors" (Gmail + Drive + Calendar futuro). Sin esto, cada nuevo connector pediría autorización aunque ya hubieras autorizado.

11. **Page con `useSearchParams` envuelto en `<Suspense>`**: requirement de Next 14 para client components que lean query params.

12. **HTML stripping casero, no DOMPurify**: las dependencias que parsean HTML serio (jsdom, DOMPurify) pesan demasiado para una limpieza simple. Mi stripper quita `<style>`, `<script>`, tags y decodifica entidades comunes. Para emails normales basta. Si en el futuro hace falta más, se añade `node-html-parser` o similar.

---

## Cómo probarlo

Tras setup de Google Cloud + variables de entorno:

### Smoke test 1 — Flow OAuth completo

1. `/connectors/new` → tipo **Gmail**.
2. Step OAuth: como es la primera vez, ves botón "Conectar con Google".
3. Click → redirect a Google. Eliges cuenta, ves la pantalla de consent con los scopes pedidos.
4. Aceptar → Google redirige a `/api/oauth/google/callback?code=...&state=...`.
5. Callback procesa, persiste credential, redirige a `/connectors/new?credentials_id=<uuid>&oauth_success=1`.
6. UI detecta los params, salta al step **configure** con badge verde "Cuenta conectada · tu@email.com".
7. Configurar query: `label:lexis-inbox` (o `is:starred newer_than:7d` para test rápido).
8. Schedule: `every:1h`. Crear.
9. En `/connectors/<id>` → "▷ Ejecutar ahora".
10. Verificar:
    - Run status: `success`.
    - Stats: items_fetched = N, items_new = N (primer run, todos nuevos).
    - En `/timeline`: aparecen mensajes con `Asunto: ...` y origin `connector_gmail`.

### Smoke test 2 — Refresh automático

1. En DB, inspeccionar `connector_credentials` del Gmail recién creado. `expires_at` debería ser ~1h después de crear.
2. Forzar expiración manualmente:

```sql
update connector_credentials
set expires_at = now() - interval '1 hour'
where id = '<credential-id>';
```

3. En `/connectors/<id>` → "▷ Ejecutar ahora".
4. Esperado: el run sigue funcionando porque el runner refresca antes.
5. Verificar en DB: `expires_at` ahora debe ser ~1h en el futuro, `access_token` distinto.

### Smoke test 3 — Idempotencia (mismo user, segunda autorización)

1. Con un Gmail connector ya creado, ir a `/connectors/new` → Gmail.
2. Step OAuth: ahora ves la card "Cuentas ya autorizadas" con tu email.
3. Click "+ Conectar otra cuenta" — redirige a Google.
4. Autorizar **misma cuenta** otra vez.
5. Verificar en DB: sigue habiendo **una sola row** en `connector_credentials` para esa cuenta. `updated_at` cambió. Scopes intactos.

### Smoke test 4 — Sync incremental con History API

1. Connector activo. Después de un run inicial, verificar en `/connectors/<id>` → "Estado interno":
   ```json
   { "last_history_id": "12345", "last_run_at": "...", "query": "..." }
   ```
2. Marcar un nuevo mensaje en Gmail con el label.
3. "▷ Ejecutar ahora".
4. Esperado: `items_fetched = 1, items_new = 1`. En el debug del run debería aparecer `"mode": "incremental"`.

### Smoke test 5 — Dedup (Sprint 10 + 11 combinados)

1. Ejecutar el connector dos veces seguidas.
2. Segunda ejecución: `items_new = 0`, `items_skipped > 0`. El dedup por external_id funcionando.

### Smoke test 6 — Manejo de errores OAuth

- En `/api/oauth/google/start` con `intent=foo` → 400 unknown_intent.
- Borrar la cookie de state antes del callback → redirige a `/oauth/google/error?code=state_mismatch`.
- Revocar el connector en Google Account → `/api/oauth/google/start?reuse_credentials_id=...` permite re-autorizar.

---

## Variables de entorno necesarias

| Variable | Para qué |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | Client ID de Google Cloud Console |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Client secret |
| `NEXT_PUBLIC_APP_URL` | Base URL para construir el redirect_uri (ya existía del Sprint 7) |
| `OAUTH_STATE_SECRET` | 32 bytes random para firmar el state CSRF |

---

## Pendiente / posibles Sprint 12

- **Adapter Drive** reutilizando 100% del OAuth Google + refresh.
- **Procesamiento de adjuntos** Gmail (PDF, doc, image) reusando el ingest pipeline + storage.
- **UI listado de credentials** en `/settings` para ver/revocar cuentas conectadas.
- **Selector de label** en config Gmail con autocomplete (`GET /api/labels` proxy a Gmail API).
- **Threading**: agrupar mensajes del mismo `gmail_thread_id` como una sola memoria (vs. una por mensaje).

---

## Checklist de cierre Sprint 11

- [ ] Variables Google configuradas en `.env.local` (y en Cloudflare Pages para producción).
- [ ] Migración Sprint 10 ya aplicada (no hay migración nueva).
- [ ] OAuth flow funciona: redirect a Google → consent → callback → redirect a `/connectors/new` con credentials_id en query.
- [ ] Step OAuth en `/connectors/new` muestra "Conectar con Google" la primera vez.
- [ ] Tras autorizar, vuelve mostrando credential pre-seleccionada con badge verde.
- [ ] Configurar Gmail connector con query → "Ejecutar ahora" → memorias creadas con origin `connector_gmail`.
- [ ] Cron (`POST /api/cron/connectors`) ejecuta el connector cuando toca según schedule.
- [ ] Refresh: forzar `expires_at` pasado → siguiente ejecución renueva el token.
- [ ] Segunda autorización con misma cuenta → no duplica row en `connector_credentials`.
- [ ] Mensajes capturados tienen metadata correcta (from, subject, thread_id, etc.).
- [ ] Página `/oauth/google/error` aparece si algo falla con código identificable.
