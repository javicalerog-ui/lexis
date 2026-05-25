# ONBOARDING · Tu primer día con Lexis

Esta guía está hecha para tu caso de uso concreto: **modo B principal** (captura sin fricción desde el móvil), con C/D/A complementarios. El proyecto se monta en ordenador, pero el uso diario es en móvil con la PWA instalada.

Tres bloques:

1. **Setup técnico** (45-90 min) — instalación, cuentas, migraciones, variables.
2. **Sembrado del grafo** (60 min) — sesión fundacional para que Lexis arranque con contexto.
3. **Día 2 en adelante** — ritmo de uso real.

---

## Bloque 1 · Setup técnico

### 1.1 — Requisitos previos

- **Node.js 20+** instalado en tu ordenador.
- **Editor** (VS Code, Antigravity, lo que uses).
- **Cuentas creadas (gratis o con tier free) en**:
  - [Supabase](https://supabase.com) (proyecto eu-west-1)
  - [Voyage AI](https://dash.voyageai.com) (200M tokens free)
  - [OpenRouter](https://openrouter.ai) (pay-as-you-go, ~$0.01 por ~100 capturas)
  - [Resend](https://resend.com) (3.000 emails/mes free)
  - [OpenAI](https://platform.openai.com) (~$0.006/min de transcripción)
  - [Google Cloud Console](https://console.cloud.google.com) (gratis, solo si quieres Gmail/Drive connectors)

### 1.2 — Clonar e instalar

```bash
git clone <tu-repo>
cd lexis
npm install
```

### 1.3 — Supabase: crear proyecto y aplicar migraciones

1. Entra en [supabase.com](https://supabase.com), crea proyecto. Región: **eu-west-1** (Ireland). Es importante por latencia.
2. Espera 1-2 min a que esté listo.
3. Ve a **Settings → Database** y anota los valores de conexión.
4. Ve a **Settings → API** y anota:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (este NO lo expongas en el cliente)
5. Antes de la primera migración, habilita la extensión **pgvector**:
   - Database → Extensions → buscar `vector` → enable.
6. Aplica las **9 migraciones en orden** desde SQL Editor:

```
1. supabase_migrations/20260522000000_initial_schema.sql
2. supabase_migrations/20260522000001_sprint2_functions.sql
3. supabase_migrations/20260522000002_sprint3_feed_cache.sql
4. supabase_migrations/20260522000003_sprint4_interviews.sql
5. supabase_migrations/20260522000004_sprint6_entity_summaries.sql
6. supabase_migrations/20260522000005_sprint7_digests.sql
7. supabase_migrations/20260522000006_sprint8_search_metrics.sql
8. supabase_migrations/20260522000007_sprint9_api_tokens.sql
9. supabase_migrations/20260522000008_sprint10_connectors.sql
```

Para cada uno: abrir el archivo, copiar todo el contenido, pegarlo en SQL Editor, **Run**. Si alguna falla, lee el error — probablemente es el orden o pgvector no habilitado.

### 1.4 — Crear `.env.local`

```bash
cp .env.example .env.local
```

Abre `.env.local` y rellena. El orden recomendado para sacar las keys:

1. **Supabase** (ya las tienes del paso 1.3).
2. **Voyage**: dash.voyageai.com → API keys → Create.
3. **OpenRouter**: openrouter.ai/keys → Create key. Añade ~$5 de crédito.
4. **Resend**: resend.com/api-keys → Create. **Importante**: para magic link auth necesitas un dominio verificado. Si no tienes uno, en modo sandbox solo puedes enviarte a ti mismo (usa el email con el que registraste Resend como destinatario). En producción, verifica tu dominio.
5. **OpenAI**: platform.openai.com/api-keys → Create. Añade ~$5 de crédito.
6. **CRON_SECRET**: genera con:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
7. **NEXT_PUBLIC_APP_URL**: `http://localhost:3000` (dev) o tu dominio (producción).

Google OAuth y `OAUTH_STATE_SECRET` puedes dejarlos vacíos por ahora. Configúralos solo cuando vayas a activar Gmail/Drive connectors (sección 3.3).

### 1.5 — Generar iconos PWA

```bash
npm run icons
```

Esto convierte `public/icon.svg` en los PNGs requeridos por iOS, Android y favicons. Si falla por falta de `sharp`, ejecuta `npm install --save-dev sharp` y vuelve a intentar.

### 1.6 — Levantar en dev

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000). Te pedirá email → magic link → click en el email → estás dentro.

Si magic link no llega: revisa `RESEND_API_KEY` y `RESEND_FROM`. En sandbox Resend solo permite enviar al email de la cuenta de Resend.

### 1.7 — Desplegar en Cloudflare Pages (opcional pero recomendado)

Para usar la PWA en el móvil **necesitas HTTPS**. localhost en el móvil es complicado, así que recomiendo desplegar antes de seguir.

1. Push del proyecto a GitHub.
2. Cloudflare Pages → Create → conecta el repo.
3. Build: Next.js · `npm run build` · output `.next` · Node 20.
4. Environment variables: copia las de `.env.local` PERO con `NEXT_PUBLIC_APP_URL` ahora apuntando a tu URL de producción (ej. `https://lexis-tu-handle.pages.dev`).
5. Deploy. Espera ~3 min.
6. Cron Triggers en Settings → 3 cron jobs (`/api/cron/connectors` cada 10min, `/api/cron/digest` cada hora, `/api/cron/refresh-summaries` cada hora), todos con header `Authorization: Bearer ${CRON_SECRET}`.

### 1.8 — Instalar PWA en el móvil

Abre la URL de producción en el móvil:

- **iOS Safari**: botón compartir → "Añadir a pantalla de inicio". Aparece icono Lexis homescreen, abre como app nativa sin barra del navegador.
- **Android Chrome**: aparece banner "Añadir Lexis a pantalla de inicio". O menú → "Instalar app".

Desde ahora abres Lexis con un tap, como cualquier app.

---

## Bloque 2 · Sembrado del grafo (Día 1)

**Por qué este bloque importa**: si arrancas con Lexis vacío, los primeros 5-10 días no le verás valor (búsqueda sin nada que buscar, feed proactivo vacío). Sembrarlo te ahorra esta fricción.

### 2.1 — Sesión fundacional con el entrevistador (45-60 min)

Esto es modo **C** del podcast aplicado al primer día. Recomiendo hacerlo en el ordenador con el entrevistador activado por voz, para que vayas dictando rápido.

1. Ve a **`/interview`** (icono ※ en el header).
2. Elige **"Exploratoria"** (no de proyecto ni de entidad).
3. El entrevistador empieza haciéndote preguntas abiertas. Responde por voz o teclado.

Plan sugerido (ajústalo a ti):

**Bloque trabajo IBD Porcelanosa (15 min)**:
- "Cuéntame los 5 proyectos más activos en los que estás ahora mismo en IBD."
- "Por cada uno, ¿qué fase está? ¿Qué pasos hay pendientes?"
- "¿Con quién interactúas en cada uno? Nombres + rol."
- "¿Qué decisiones importantes has tomado las últimas dos semanas?"

**Bloque organizacional (5 min)**:
- "Háblame de tu equipo: a quién reportas, quién reporta a ti, con quién trabajas día a día."

**Bloque Gaiata y festes (10 min)**:
- "Estado actual de Gaiata 1 Brancal de la Ciutat: qué hay hecho, qué falta, fechas clave."
- "Comisión: quiénes son, qué papel tiene cada uno."

**Bloque proyectos personales (10 min)**:
- "Qué proyectos personales tienes vivos ahora mismo: Clavis, Lexis, Magdalena OS, lo que sea."
- "Por cada uno: estado actual y siguiente paso concreto."

**Bloque contexto general (5 min)**:
- "Eventos importantes de las últimas 4 semanas que quieras recordar."
- "Personas con las que has tenido conversaciones relevantes últimamente."

Al final tendrás ~100-180 memorias con su grafo de proyectos y entidades correctamente clasificadas. **Esta es la base sobre la que Lexis va a operar**.

### 2.2 — Verificar el grafo sembrado

Después de la sesión:

1. **`/dashboard`** (icono ⌬) — deberías ver memorias totales, proyectos activos, entidades. Si los números están bajos (<50 memorias), prolonga la sesión.
2. **`/projects`** (icono ✦) — comprueba que los proyectos importantes están todos y tienen rolling_summary autogenerado. Si alguno falta, créalo manualmente.
3. **`/entities`** (icono ◇) — verifica que las personas clave (Alfonso, Jose María, etc.) aparecen como entidades con sus key_facts.

### 2.3 — Conectar Drive (10 min)

Si quieres que Lexis se alimente solo de tus documentos:

1. Setup previo Google Cloud Console (ver [`.env.example`](./.env.example) sección Google OAuth para los 5 pasos).
2. Añade `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` y `OAUTH_STATE_SECRET` a tu `.env.local` y a las env vars de Cloudflare. Redeploy.
3. **`/connectors/new`** (icono ⇲) → **Google Drive** → Conectar con Google → autorizar.
4. Config:
   - Folder ID: ID de tu folder principal de IBD (lo coges de la URL en Drive cuando abres la carpeta).
   - Tipos: "Docs + Sheets" para empezar (más manejable que "Todo").
   - Schedule: `every:6h`.
   - Include shared: tú decides.
5. Crear → "Ejecutar ahora" para sembrar inicial.

### 2.4 — Conectar Gmail (10 min)

Para que ciertos emails se vayan capturando solos:

1. **`/connectors/new`** → **Gmail** → Usar misma cuenta Google que Drive (merge automático de scopes).
2. Config:
   - Query: `label:lexis-inbox` (lo más simple — tú decides qué emails enviar a Lexis aplicando ese label manualmente).
   - Alternativa más agresiva: `from:cliente-importante.com OR from:jefe@empresa.com newer_than:7d`.
   - Schedule: `every:1h`.
3. En Gmail, crea el label "lexis-inbox" y aplícalo a 5-10 emails de las últimas semanas que quieras tener en Lexis.
4. Crear → "Ejecutar ahora" → verifica que los emails aparecen en `/timeline`.

### 2.5 — Conectar Google Calendar (10 min, Sprint 14)

Lexis lee tus eventos como memorias y puede crear eventos cuando se lo pides. Con safety net: lo que crea va a un calendario llamado **"Lexis · Borradores"** que se autocrea, no toca tu primary.

1. Antes en **Google Cloud Console**: APIs & Services → Library → habilita **Google Calendar API**. Y OAuth consent screen → añade scope `https://www.googleapis.com/auth/calendar` (el completo, no readonly).
2. **`/connectors/new`** → **Google Calendar** → usar misma cuenta Google que los anteriores (merge de scopes automático).
3. Config:
   - `calendar_ids`: déjalo en `primary` para empezar. Más tarde, tras autorizar, llama `GET /api/credentials/google/calendars` para ver los IDs de calendarios secundarios que quieras añadir.
   - `lookback_days`: 30 (cuántos días pasados sincronizar en el primer run).
   - `lookahead_days`: 90 (cuántos futuros).
   - Schedule: `every:30m`.
4. Crear → "Ejecutar ahora". Tus eventos aparecen en `/timeline` y los próximos 14 días en la sección "Próximos eventos" de `/feed`.

### 2.6 — Sincronizar Outlook corporativo vía ICS (5 min)

Lexis no se conecta a Microsoft 365. Para tener tu agenda corporativa en Lexis:

1. **Outlook Web** → Calendar → ⚙ Settings → "Calendar" → "Shared calendars" → "Publish a calendar".
2. Selecciona el calendario que quieras compartir (típicamente "Calendar"), permisos "Can view all details", publish.
3. Copia el **ICS link** (URL terminada en `.ics`).
4. **Google Calendar** (calendar.google.com) → izquierda → "Other calendars" → **+** → "From URL" → pega el ICS link.
5. Espera 6-24h la primera sincronización. Después es automática cada pocas horas.

Como alternativa rápida y bajo demanda, sin esperar a la sincronización ICS, puedes usar el **modo "Foto del calendario"** del FAB (Sprint 15): foto a tu vista semanal de Outlook → Lexis extrae los eventos visibles → revisas y creas en Google Calendar.

### 2.7 — Push notifications + VAPID (5 min, Sprint 16)

Para que Lexis te avise antes de reuniones, follow-ups y demás:

1. **Genera las claves VAPID** una sola vez:
   ```bash
   npx web-push generate-vapid-keys
   ```
2. Copia las dos claves a `.env.local`:
   ```
   VAPID_PUBLIC_KEY=BNb...
   VAPID_PRIVATE_KEY=xWa...
   VAPID_SUBJECT=mailto:tu@email.com
   ```
3. Si vas a producción, replícalas en **Cloudflare Pages → Settings → Environment variables**.
4. Reinicia el server (`npm run dev` de nuevo).
5. En el navegador: instala la PWA (Sprint 13 Bloque 1.8 si no lo has hecho).
6. **`/settings/notifications`** → **"Conectar este dispositivo"** → acepta el permiso del navegador.
7. Configura abajo lo que quieras: tipos, anticipación, silencio nocturno (default 22:00→08:00 hora Madrid).

### 2.8 — Activar reglas proactivas (3 min, Sprint 17)

1. **`/settings/proactive-rules`**. Verás las 5 reglas preset autocreadas.
2. Repasa cada una y deshabilita las que no encajen contigo. Por defecto todas están activas.
3. Si quieres una regla custom propia (e.g. "domingo a las 21:00 recuérdame planificar la semana"):
   - "+ Nueva regla" → completar campos → Guardar.
   - Si Lexis detecta solape con una preset, te muestra el conflicto y tú decides: quedarte con la tuya (deshabilita la preset), descartar la tuya, o mantener ambas.

Lexis tarda hasta 5 min en evaluar las reglas (frecuencia del cron). Para forzar:

```bash
curl -X GET -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/proactive
```

### 2.9 — Bandeja `/inbox` (1 min, Sprint 18)

Cuando una regla dispara, además del push se crea una entrada en `/inbox` (icono ⊞ en el header, con badge cuando tienes pendientes). Cada entrada tiene quick replies tappeables:

- **Reunión en 30 min con Alfonso** → "Ver contexto" o "Cerrar".
- **Hoy: enviar la propuesta a X** → "Hecho" / "Posponer 2 días" / "Ya no aplica".
- **Proyecto Polonia durmiendo 32 días** → "Sigue activo" / "Archivar" / "Posponer revisión 14d".

Si ninguna quick reply te encaja, toca el botón **◉** y responde libremente por voz: Lexis lo guarda como memoria vinculada a esa acción.

### 2.10 — Configurar el digest semanal (3 min)

1. **`/digest`** (icono ✉).
2. Cadencia: semanal. Día: lunes. Hora UTC: 7 (8am hora España invierno, 9am verano).
3. Email destinatario.
4. Activar.

A partir del lunes siguiente recibirás cada semana un email con el panorama de tu grafo.

---

## Bloque 3 · Día 2 en adelante

Aquí entra el **modo B** (captura sin fricción, móvil).

### 3.1 — Ritmo diario

**Mañana** (1 min en el café):
- Abre la PWA en el móvil.
- Si tienes pasos pendientes urgentes → `/feed` (◈).
- Si no → ya está, sigues con tu día.

**Durante el día** (cuando salga la situación):
- Al salir de una reunión: abres PWA → **FAB de voz** (botón redondo flotante azul/violeta abajo a la derecha) → dictado de 20-60s con lo importante → toque "OK" → se ingiere y vuelves a tu vida.
- Cuando lees algo interesante en email: lo etiquetas con `lexis-inbox` en Gmail → en máximo 1h aparece en Lexis automático.
- Cuando escribes un Doc importante: lo guardas en tu folder de Drive → en máximo 6h aparece en Lexis automático.

**Antes de reuniones importantes** (modo D, 2 min):
- En la PWA: tap a buscar → escribir nombre de la persona o proyecto.
- Aparecen las memorias relevantes. Lees, refrescas contexto.
- O si es una persona con muchas interacciones: `/entities/[id]` → ficha completa con key_facts, highlights, threads abiertos.

**Domingo o cuando quieras** (modo C, ocasional):
- Sesión de entrevista de 20-30 min sobre un proyecto concreto, una persona concreta, o exploratoria.
- Útil cuando notas que tienes mucho en la cabeza y quieres vaciarlo.

### 3.2 — Atajos de teclado (desktop)

- `C` — Abre el FAB de voz desde cualquier página.

### 3.3 — Métricas de salud

Cada 2-3 semanas revisa:
- **`/dashboard`** — ¿estás creciendo en memorias? ¿hay proyectos abandonados (no captura desde hace 60d)?
- **Digest semanal por email** — ¿sigue siendo útil? ¿hay info que falta o sobra?
- **`/connectors/<id>`** — ¿los connectors siguen funcionando? Si `last_run_status: failed`, mira el último error.

---

## Troubleshooting común

| Síntoma | Probable causa | Solución |
|---|---|---|
| Magic link no llega | Resend en sandbox solo permite emails a tu cuenta Resend | Verifica dominio en Resend o usa tu propio email para probar |
| Búsqueda devuelve vacío | Sin memorias todavía o el embedding falla | Captura 10-20 cosas primero. Verifica `VOYAGE_API_KEY` |
| FAB no aparece | Estás en `/`, `/interview`, `/login` o `/oauth/*` | Es intencional. Ve a otra página |
| PWA no se instala en iOS | Falta HTTPS o icono apple-touch | Despliega en Cloudflare Pages (Sprint 1.7) |
| Cron no ejecuta connectors | CRON_SECRET no coincide o trigger mal configurado | Cloudflare → Cron Triggers → verificar header Authorization |
| Gmail capture vacío | Query no matchea ningún email | Pon una query más amplia tipo `is:starred newer_than:7d` para probar |
| Drive captura solo títulos | `include_metadata_only=true` y mime_type=pdf | Cambia a "Solo Google Docs" para extraer contenido real |
| Token API devuelve 401 | Token revocado/expirado o scope insuficiente | `/settings/tokens` → ver estado, generar nuevo si hace falta |
| Calendar connector falla con `no_calendar_scope` | OAuth se hizo antes de añadir scope `calendar` | Re-autoriza desde `/connectors/new` → Google Calendar (merge scopes) |
| `Lexis · Borradores` no se crea | Falta scope `calendar` completo (no readonly) | Verifica que el OAuth consent screen tiene `https://www.googleapis.com/auth/calendar` (sin `.readonly`) |
| Eventos del Calendar no aparecen en `/feed` | Sync no se ha ejecutado aún | `/connectors/<id>` → "Ejecutar ahora", o espera al próximo cron |
| Foto del calendario detecta 0 eventos | Imagen borrosa, baja resolución o vista no estándar | Sube en horizontal con buena luz; las vistas semanal/diaria funcionan mejor que mensual |
| Push notifications no llegan | VAPID keys mal o faltan; permiso denegado en navegador | `/settings/notifications` → ver si dice "Permisos denegados"; en Cloudflare verificar VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY |
| Push llega pero no abre la app correcta | Service worker antiguo cacheado | Settings → unregister SW; o cambiar `CACHE_VERSION` en `public/sw.js` y redeployar |
| Reglas proactivas no disparan | Cron `/api/cron/proactive` no configurado en CF Pages | Añadir trigger `*/5 * * * *` con Bearer header (Sprint 17 README) |
| Detector de conflictos no salta nunca | Las reglas son muy distintas, no hay solape real | Funciona como esperado; el detector es deliberadamente conservador para no molestar |
| Repaso de viernes llega en quiet hours | Quiet hours mal configurado en zona del user | `/settings/notifications` → revisa franja; las preset corren a las 17:00 hora Madrid |

---

## Costes mensuales estimados (uso personal)

Suponiendo ~30 capturas/día (10 por voz, 20 por importer):

| Servicio | Coste mes | Notas |
|---|---|---|
| Supabase | $0 | Free tier suficiente |
| Cloudflare Pages | $0 | Free tier |
| Voyage AI | $0 | Free tier 200M tokens (te dura años) |
| OpenRouter | ~$2-5 | Gemini Flash + Sonnet escalado |
| OpenAI (Whisper + TTS) | ~$3-8 | Depende de cuánto dictes |
| Resend | $0 | Free tier 3.000 emails/mes |
| **Total** | **~$5-15/mes** | |

---

Listo. Ahora la pelota está en tu tejado: sembrar el grafo en una sesión bien hecha, instalar la PWA en el móvil, y empezar a dictarle a Lexis cosas durante 2 semanas. La densidad del grafo crece exponencialmente con el uso.
