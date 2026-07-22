# Sprint 10 — Connectors (infraestructura base)

Sustituto de n8n nativo en Lexis. **Sprint 10 entrega solo la infraestructura** — el engine reutilizable que permite plugar conectores específicos después con interfaz uniforme. Sprint 11 = Gmail. Sprint 12 = Drive.

Pero ya hay dos adapters útiles funcionando:
- **Webhook entrante** — recibe POSTs de Zapier, IFTTT, formularios, curl, lo que sea.
- **RSS / Atom** — polea feeds y captura nuevos items como memorias.

---

## Qué se ha implementado

### Schema (`supabase_migrations/20260522000008_sprint10_connectors.sql`)

Tres tablas + un RPC + dos enums.

`connector_credentials` — tokens OAuth y API keys por provider. Pensada para que **una credential pueda alimentar varios connectors** del mismo provider (una cuenta Google → Gmail + Drive). Sprint 10 la deja preparada; Sprint 11 la usará.

`connectors` — instancias configuradas: tipo, nombre, schedule, config JSON, credentials_id opcional, webhook_secret_hash opcional, last_run_at, last_run_status, last_error, last_state JSON.

`connector_runs` — histórico de ejecuciones con stats (items_fetched, items_new, items_skipped, items_failed), error_message, payload de debug.

RPC `list_connectors_with_stats(user_id)` que devuelve cada connector + sus `runs_24h` y `items_24h` agregados. Una query para toda la página de lista.

RLS habilitado en las tres tablas. El user solo ve los suyos.

### Sistema de adapters

**Interfaz uniforme** (`src/lib/connectors/types.ts`):

```typescript
interface ConnectorAdapter {
  type: string;
  label: string;
  description: string;
  glyph: string;
  oauth_provider: string | null;
  supports_schedule: boolean;
  supports_webhook: boolean;
  validate_config?(config): { ok: boolean; error?: string };
  run?(ctx: AdapterContext): Promise<AdapterRunResult>;       // pull
  handle_webhook?(payload, ctx): Promise<AdapterRunResult>;   // push
  config_schema?: ConfigField[];                              // genera UI dinámica
}
```

Cada adapter devuelve `{ items, new_state, debug? }`. El runner se encarga de pasar items por `ingest()` y persistir el state.

**Registry** (`src/lib/connectors/registry.ts`): array central con todos los adapters disponibles. Para Sprint 11/12 basta con añadir `gmailAdapter` y `driveAdapter` aquí.

### Adapters incluidos

**1. Webhook genérico** (`src/lib/connectors/adapters/webhook.ts`)

Recibe cualquier POST. Config:
- `content_path`: JSONPath simple para extraer el texto (`$.content`, `$.body.message`, etc.)
- `title_path`: ruta opcional al título
- `external_id_path`: ID estable del origen (para dedup)
- `source_type`: text / url / md

Soporta payloads JSON y texto plano. Cubre Zapier, IFTTT, formularios web, Slack outgoing webhooks, scripts curl, n8n haciendo HTTP request, lo que sea.

**2. RSS / Atom** (`src/lib/connectors/adapters/rss.ts`)

Pull-based, schedule configurable. Config:
- `feed_url`: URL del feed
- `include_description`: si true añade el snippet al título
- `max_age_days`: ignora items publicados hace más de N días al primer run

State: `seen_ids[]` (últimos 300 IDs vistos) para dedup. Parser RSS+Atom propio sin dependencias (~30 líneas). Cap de 30 items por run para no saturar al primer poll de feeds enormes.

### Scheduler (`src/lib/connectors/scheduler.ts`)

Sin cron parser completo. Sintaxis simple:
- `every:15m`, `every:1h`, `every:6h`, `every:1d` — cada X
- `daily:7` — todos los días a las 7 UTC
- `daily:7:30` — todos los días a las 7:30 UTC
- `null` o vacío — solo webhook/manual

`shouldRunNow(schedule, lastRunAt)` devuelve `{ should_run, reason }`. Si después haces falta cron real, lo añades sin romper estos.

### Runner (`src/lib/connectors/runner.ts`)

Ejecuta un connector end-to-end:

1. Carga adapter, credentials, estado.
2. Crea fila en `connector_runs` con `status='running'`.
3. Llama a `adapter.run()` o `adapter.handle_webhook()`.
4. Para cada item devuelto:
   - **Dedup por external_id**: busca memoria con `source_metadata->>external_id` = ese id.
   - Si no existe, llama a `ingest()` del pipeline normal (mismo embed, classifier, projects/entities que las capturas manuales).
5. Actualiza `connectors.last_*` y `connector_runs` con stats finales.

El status final puede ser `success` / `partial` (algunos items fallaron) / `failed` (todos fallaron o excepción).

### Webhook secrets (`src/lib/connectors/webhook-secret.ts`)

Formato `whk_<40 hex chars>`. SHA-256 hash en DB, prefix de 8 chars visible. Mismo patrón que los PATs: se muestra al user una vez al crear. Rotable desde la UI del connector.

### Endpoints API

| Endpoint | Método | Auth | Función |
|---|---|---|---|
| `/api/connectors` | GET | Sesión | Lista con stats. `?include_adapters=1` añade tipos disponibles |
| `/api/connectors` | POST | Sesión | Crear. Devuelve plain webhook_secret una vez |
| `/api/connectors/[id]` | GET | Sesión | Detalle |
| `/api/connectors/[id]` | PATCH | Sesión | Actualizar. `rotate_webhook_secret: true` genera nuevo |
| `/api/connectors/[id]` | DELETE | Sesión | Borrar |
| `/api/connectors/[id]/run` | POST | Sesión | Trigger manual ("Ejecutar ahora") |
| `/api/connectors/[id]/runs` | GET | Sesión | Histórico paginado |
| `/api/connectors/[id]/inbound` | POST | **Público + secret** | Webhook receiver |
| `/api/cron/connectors` | POST | CRON_SECRET | Dispatcher, ejecuta los que tocan |
| `/api/cron/connectors` | GET | CRON_SECRET | Dry-run: muestra decisiones sin ejecutar |

### UI

**`/connectors`** (icono ⇲ en header):

Lista con cards por connector. Cada uno muestra: glyph + nombre + tipo, toggle enabled/disabled, schedule + has_webhook + stats 24h, status pill (ok/fail/partial), tiempo relativo último run, preview del último error si lo hay. Empty state limpio si no hay connectors.

**`/connectors/new`** flujo de dos pasos:

1. **Pick**: grid de adapters disponibles con glyph, label, descripción y tags `pull` / `push` / `oauth` color-coded. Sección "Próximamente" con Gmail (Sprint 11) y Drive (Sprint 12) en cards mutadas.

2. **Configure**: card hero del adapter elegido (cambiable), inputs para nombre, schedule pills, toggle de webhook (si aplica), **form dinámico generado desde `config_schema`** del adapter (soporta text / textarea / select / number / boolean).

Al crear: banner verde glowing con URL + secret + ejemplo curl listo para copiar. El secret solo se muestra esta vez.

**`/connectors/[id]`** detalle completo:

- Hero card con nombre + tags (type/schedule/webhook prefix) + toggle enabled.
- Actions row: "▷ Ejecutar ahora" (deshabilitado si está disabled), "↻ Rotar secret" (si tiene webhook), "Eliminar" (con confirm).
- Sección Webhook con URL + secret prefix + copy + hint.
- Sección Configuración con JSON pretty.
- Sección Estado interno colapsable (cursor, seen_ids, etc.).
- Sección Ejecuciones con últimas 20 runs: status pill (ok/fail/partial/running con pulse), trigger (cron/manual/webhook), timestamp, stats (fetched / new / skipped / failed), error message si hubo.

Banner verde adicional cuando rotas el secret.

### Header del chat principal

Añadido ⇲ (Connectors) entre ✉ Digest y ⤒ Export. El header ya tiene 11 elementos navegables + logout — sigue funcionando con scroll horizontal silencioso del Sprint 8.

---

## Decisiones técnicas

1. **Schedule simple, no cron**: cubre el 95% de casos (cada X / diario a hora H). Cron real se añade sin romper si hace falta.

2. **Service role en el runner**: porque hace queries cross-table (memories, projects, entities) y necesita saltarse RLS de forma controlada. Cada query filtra `user_id` explícitamente. El cron y el inbound webhook ambos usan service role; el filtering manual es la barrera de seguridad.

3. **Dedup por external_id en source_metadata**: cada item del adapter trae un `external_id` único (`gmail_msg_<id>`, `rss_<guid>`, `webhook_<connector>_<id>`). El runner busca memorias con ese metadata antes de ingerir, evita duplicados aunque el adapter reprocese.

4. **State per-connector**: cada adapter persiste lo que necesita (`seen_ids` para RSS, `last_message_id` para Gmail futuro, `last_received_at` para webhook). El runner solo lo guarda y carga, no lo interpreta.

5. **Webhook secrets separados de credentials**: porque son conceptos diferentes. Las credentials son tokens del provider externo (Google, Microsoft); los webhook secrets son la auth de Lexis hacia quien envía POSTs. Un connector puede tener ambos (Gmail con OAuth + webhook entrante de Gmail notifications).

6. **Webhook endpoint público con secret en header**: el endpoint `/api/connectors/[id]/inbound` no requiere sesión Lexis. Validación solo por `X-Connector-Secret` SHA-256 match. Esto permite que Zapier/IFTTT/cualquier servicio sin OAuth lo use. Mismo modelo que Stripe webhooks.

7. **Config schema declarado por el adapter, UI dinámica**: cada adapter declara sus campos (`type: text/textarea/select/number/boolean`, label, description, default, placeholder). La UI los renderiza sin código específico. Añadir Gmail/Drive en Sprint 11/12 = solo añadir adapter, **sin tocar la UI de alta**.

8. **Tabla credentials separada de connectors**: una cuenta Google sirve Gmail + Drive + Calendar. La credential se puede compartir entre N connectors. Sprint 11 implementará el flujo OAuth Google que pueble esta tabla.

9. **Cron evaluación granular**: el dispatcher se llama (idealmente) cada 5-10 minutos desde Cloudflare Cron Triggers. Cada llamada lista todos los connectors enabled con schedule y evalúa uno a uno si toca. No hay scheduler distribuido; PostgreSQL es la fuente de verdad.

10. **Decisión histórica, sustituida el 2026-07-22**: Sprint 10 nació guardando `access_token`/`refresh_token` en plano. El runtime actual usa sobres autenticados AES-256-GCM `enc:v1`, ligados al campo y a la fila, y rechaza texto plano. Las instalaciones heredadas deben seguir `docs/SECURITY-P0-CREDENTIALS-2026-07-22.md`.

---

## Cómo probarlo

Tras aplicar la migración Sprint 10:

### Smoke test 1 — Crear webhook + curl POST

1. `/connectors` → "+ Añadir connector" → tipo **Webhook entrante**.
2. Configurar:
   - Nombre: "Test curl"
   - `content_path`: `$.content` (default)
   - Source type: text
3. Crear → aparece banner verde con URL + secret.
4. Copiar ambos. Desde terminal:

```bash
curl -X POST \
  -H "X-Connector-Secret: whk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"content": "Hola desde curl", "id": "test-001"}' \
  https://lexis.tu-dominio.com/api/connectors/<connector-id>/inbound
```

Esperado: `{"run":{"status":"success","items_new":1,...}}`.

5. Ir a `/timeline` — debe aparecer "Hola desde curl" con origin `connector_webhook`.
6. Ir a `/connectors/<id>` — la run aparece en el histórico con trigger=webhook.
7. Repetir el curl con mismo `id` — esperado `items_skipped=1, items_new=0` (dedup).

### Smoke test 2 — Crear RSS + ejecución manual

1. `/connectors/new` → tipo **RSS / Atom**.
2. `feed_url`: `https://hnrss.org/frontpage` (cualquier feed activo).
3. Schedule: `every:6h`.
4. Crear. Ir al detalle.
5. Click "▷ Ejecutar ahora". Esperar.
6. Verificar:
   - Status pill verde "ok".
   - Stats: fetched ≈ 30, new ≈ 30 (primer run), skipped = 0.
   - En `/timeline`: aparecen items con source `URL`, origin `connector_rss`.
7. Volver a ejecutar manualmente — items_new pequeño o 0, items_skipped alto.

### Smoke test 3 — Cron dispatcher

Configurar variable de entorno `CRON_SECRET=<algún-valor>`. Después:

```bash
# Dry-run: ver qué decidiría sin ejecutar
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://lexis.tu-dominio.com/api/cron/connectors

# Ejecución real
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://lexis.tu-dominio.com/api/cron/connectors
```

Esperado: respuesta JSON con `executed`, `skipped`, `failed` y lista de resultados por connector.

En **Cloudflare Pages**: configurar Cron Trigger cada 10 minutos llamando `POST /api/cron/connectors` con el header de auth.

### Smoke test 4 — Rotación de secret

1. En `/connectors/<id>` con webhook activo → "↻ Rotar secret".
2. Confirmar. Aparece banner verde con el nuevo secret.
3. Intentar curl con el **secret antiguo**: esperado `401 invalid_secret`.
4. Curl con el **nuevo**: funciona.

### Smoke test 5 — Disable / re-enable

1. Toggle off en `/connectors`.
2. Intentar webhook curl: `423 connector_disabled`.
3. `POST /api/cron/connectors`: el connector queda fuera del candidates list.
4. Toggle on. Webhook y cron vuelven a funcionar.

---

## Cuándo es útil cada adapter

### Webhook entrante
- Formularios web (Typeform, Tally) que envían respuestas.
- Zapier/IFTTT/Make como triggers ("when new email matches X, send to Lexis").
- Scripts cron en tu VPS que curlean.
- Slack outgoing webhooks de un canal específico.
- Apps móviles propias que capturen con un POST.

### RSS / Atom
- Releases de GitHub: `https://github.com/<user>/<repo>/releases.atom`
- Blogs / newsletters que tengan feed.
- Podcasts: el feed RSS lleva metadata + descripción de cada episodio.
- Search Google News como RSS: `https://news.google.com/rss/search?q=<query>`
- Anuncios de productos (Hacker News, Product Hunt vía RSS).

---

## Lo que queda para Sprint 11 (Gmail)

Plan acordado:

- **OAuth2 Google**:
  - Endpoints `/api/oauth/google/start` y `/api/oauth/google/callback`.
  - Scopes: `gmail.readonly` para Sprint 11; `drive.readonly` se añade en Sprint 12.
  - Persistir en `connector_credentials` con `provider='google'`, `access_token` y `refresh_token` cifrados, `expires_at`, `account_identifier=<email>`.
  - Helper `refreshIfNeeded(credentials)` que renueve el access_token cuando expira y persista.
- **Adapter Gmail** (`src/lib/connectors/adapters/gmail.ts`):
  - Config: `label_filter` (e.g. "lexis-inbox"), `query` (gmail search syntax), `include_attachments` (bool).
  - State: `last_history_id` para incremental sync via Gmail History API.
  - Mapeo: cada mensaje → memoria con `source_type='text'`, contenido = subject + body, metadata con from/to/thread_id.
- **UI**: en `/connectors/new` aparece "Gmail" en el grid. Al elegirlo, redirige a `/api/oauth/google/start?next=...` antes del form. Tras callback, el form ya tiene credentials_id seleccionado.

Estimación: ~250-350 líneas del adapter + ~200 del flow OAuth.

## Lo que queda para Sprint 12 (Drive)

- Reutiliza el OAuth Google del Sprint 11 (el usuario solo se reautentica si no tenía el scope `drive.readonly`).
- **Adapter Drive** (`src/lib/connectors/adapters/drive.ts`):
  - Config: `folder_id` (opcional, raíz si vacío), `mime_types` (filtrar PDF/Doc/Sheets/etc.), `include_shared` (bool).
  - State: `start_page_token` para Drive Changes API (delta incremental).
  - Para cada archivo modificado: descargar contenido vía Drive API export (Doc → text, Sheet → CSV, PDF → bytes), capturar como memoria con `source_type` apropiado.

---

## Checklist de cierre Sprint 10

- [ ] Migración `20260522000008_sprint10_connectors.sql` aplicada.
- [ ] `/connectors` carga, muestra el empty state.
- [ ] Crear webhook entrante → secret se muestra una vez con ejemplo curl.
- [ ] curl POST al inbound con el secret correcto → memoria creada.
- [ ] curl POST con secret incorrecto → 401.
- [ ] Repetir curl con mismo external_id → items_skipped=1.
- [ ] Crear RSS → "Ejecutar ahora" → items_new > 0.
- [ ] Volver a ejecutar → items_skipped > 0 (dedup funciona).
- [ ] Toggle off connector → curl webhook devuelve 423.
- [ ] Rotar secret → secret antiguo falla, nuevo funciona.
- [ ] `GET /api/cron/connectors` (dry-run) muestra decisiones correctas.
- [ ] `POST /api/cron/connectors` ejecuta los que tocan.
- [ ] Header del chat principal muestra ⇲ Connectors.
- [ ] Eliminar connector → desaparece de la lista y sus runs también.

Sprint 11 (Gmail) y Sprint 12 (Drive) cuando estés listo.
