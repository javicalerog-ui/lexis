# Lexis · Segundo cerebro personal

Tu segundo cerebro: captura cualquier cosa por voz, texto, archivo o vía conectores (Gmail, Drive, webhooks, RSS), Lexis la vectoriza, la clasifica en proyectos/entidades, y te ayuda a recordar y razonar sobre tu vida.

PWA instalable. Captura sin fricción desde el móvil con un FAB siempre disponible. Sincronización incremental con tu Gmail y Drive. Digest semanal por email. Búsqueda semántica con filtros. Dashboard. API pública con tokens. Export completo del grafo.

---

## Inicio rápido

**Si es tu primera instalación, abre primero [`ONBOARDING.md`](./ONBOARDING.md)** — la guía paso a paso del día 1 (mucho más completa que esta sección).

```bash
git clone <tu-repo>
cd lexis
npm install
cp .env.example .env.local      # rellenar variables
npm run icons                   # genera iconos PWA desde icon.svg
npm run dev                     # http://localhost:3000
```

Antes de levantar necesitas:
1. Proyecto Supabase nuevo con las **9 migraciones aplicadas** (ver sección abajo).
2. Variables de entorno en `.env.local` (ver `.env.example`).

---

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | Next.js 14 App Router · React 18 · TypeScript · CSS Modules |
| Hosting | Cloudflare Pages |
| Base de datos | Supabase (Postgres) · eu-west-1 · pgvector |
| Auth | Magic link vía Resend |
| Embeddings | Voyage AI · `voyage-4-lite` (1024 dims) |
| LLM | OpenRouter · Gemini 3 Flash → Sonnet 4.6 (escalación adaptativa) |
| Audio | OpenAI Whisper + tts-1 · (alt: Groq Whisper) |
| Email | Resend (auth + digest) |
| OAuth | Google (Gmail + Drive) |

---

## Variables de entorno

Copia `.env.example` a `.env.local` y rellena. Resumen:

### Imprescindibles para arrancar

| Variable | Para qué | Dónde obtenerla |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Endpoint Supabase | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Key cliente | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Key server-side | Supabase → Settings → API |
| `VOYAGE_API_KEY` | Embeddings | https://dash.voyageai.com |
| `OPENROUTER_API_KEY` | LLM | https://openrouter.ai/keys |
| `LLM_ESCALATION_THRESHOLD` | Umbral Gemini→Sonnet (0.7 default) | — |
| `RESEND_API_KEY` | Magic link + digest | https://resend.com/api-keys |
| `RESEND_FROM` | Remitente auth | Tu dominio verificado |
| `RESEND_DIGEST_FROM` | Remitente digest | Tu dominio |
| `NEXT_PUBLIC_APP_URL` | Base URL pública | `http://localhost:3000` o tu dominio |
| `CRON_SECRET` | Protege `/api/cron/*` | Generar 32 bytes random |
| `CONNECTOR_CREDENTIALS_ENCRYPTION_KEY` | Cifra OAuth/API keys de connectors en reposo | Generar 32 bytes; guardar en secret manager |

### Habilitan features adicionales

| Variable | Habilita |
|---|---|
| `OPENAI_API_KEY` | Captura por voz (Whisper) + TTS del entrevistador |
| `GROQ_API_KEY` | Alternativa a OpenAI para Whisper (más rápido y barato) |
| `AUDIO_PROVIDER` | `openai` o `groq` |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | Connectors Gmail + Drive |
| `OAUTH_STATE_SECRET` | Firma del CSRF state (32 bytes random) |
| `CONNECTOR_CREDENTIALS_PREVIOUS_KEY` | Ventana temporal para rotar la clave de cifrado; retirar tras migrar |

Setup completo en [`.env.example`](./.env.example) con URLs y comentarios sobre cada una.

---

## Migraciones SQL (orden de aplicación)

Todas en `supabase_migrations/`. Aplicar **en este orden exacto** mediante el SQL editor de Supabase o con `supabase db push`:

| # | Archivo | Qué crea |
|---|---|---|
| 1 | `20260522000000_initial_schema.sql` | Tablas core: memories, projects, entities, links, RLS |
| 2 | `20260522000001_sprint2_functions.sql` | RPC `search_memories` con pgvector |
| 3 | `20260522000002_sprint3_feed_cache.sql` | Tabla feed_cache con TTL 1h |
| 4 | `20260522000003_sprint4_interviews.sql` | interview_sessions + interview_messages |
| 5 | `20260522000004_sprint6_entity_summaries.sql` | Columnas + triggers + RPC entity_cooccurrence |
| 6 | `20260522000005_sprint7_digests.sql` | digest_preferences + digests + cadence enums |
| 7 | `20260522000006_sprint8_search_metrics.sql` | RPCs search_filtered + activity_buckets + metrics_snapshot |
| 8 | `20260522000007_sprint9_api_tokens.sql` | personal_access_tokens + bump_pat_last_used |
| 9 | `20260522000008_sprint10_connectors.sql` | connector_credentials + connectors + connector_runs |
| 10 | `20260523000000_sprint14_user_settings.sql` | user_settings (timezone, quiet_hours, draft_calendar_id) |
| 11 | `20260523000001_sprint15_events.sql` | events + enums (event_type, event_status, event_source) + RPC upcoming_events |
| 12 | `20260523000002_sprint16_push.sql` | push_subscriptions con upsert por endpoint |
| 13 | `20260523000003_sprint17_proactive_rules.sql` | proactive_rules con kind preset/custom |
| 14 | `20260523000004_sprint18_agent_actions.sql` | agent_actions + enum action_status + RPC pending_actions_count |

No hay migración para Sprints 11/12/13 (reutilizan el schema existente).

---

## Cron jobs en producción

En Cloudflare Pages → Settings → Cron Triggers, configurar cuatro triggers con header `Authorization: Bearer ${CRON_SECRET}`:

| Endpoint | Frecuencia recomendada | Función |
|---|---|---|
| `POST /api/cron/connectors` | Cada 10 min | Ejecuta connectors con schedule (Gmail/Drive/Calendar/RSS/...) |
| `POST /api/cron/digest` | Cada hora | Genera y envía digests semanal/diario cuando toca |
| `POST /api/cron/refresh-summaries` | Cada hora | Refresca rolling_summaries de proyectos/entidades stale |
| `GET /api/cron/proactive` | **Cada 5 min** | Evalúa proactive_rules y dispara acciones + push (Sprint 17) |

En dev puedes triggear manualmente:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/connectors
```

Todos los endpoints cron usan exclusivamente `Authorization: Bearer ${CRON_SECRET}`.
`X-CRON-SECRET` no forma parte del contrato y se rechaza. Un `CRON_SECRET` ausente
o de menos de 32 bytes deja los endpoints cerrados.

## Seguridad de credenciales de connectors

Los access tokens, refresh tokens y API keys se guardan como sobres autenticados
AES-256-GCM (`enc:v1`); el runtime rechaza tanto texto plano heredado como una clave
ausente, incorrecta o un ciphertext manipulado. Los PAT de la API continúan
guardándose exclusivamente como hash.

Una instalación que ya tenga filas en `connector_credentials` debe ejecutar el
procedimiento de mantenimiento y rotación de
[`docs/SECURITY-P0-CREDENTIALS-2026-07-22.md`](./docs/SECURITY-P0-CREDENTIALS-2026-07-22.md)
antes de reactivar connectors. El código local no ejecuta esa migración remota por sí solo.

---

## Estructura del proyecto

```
lexis/
├── src/
│   ├── app/                    # App Router pages + endpoints API
│   ├── components/             # Components reutilizables
│   ├── lib/                    # Lógica de negocio
│   ├── hooks/                  # React hooks
│   └── types/                  # Tipos TS compartidos
├── supabase_migrations/        # SQL migrations en orden
├── public/                     # Assets estáticos + PWA
├── scripts/                    # generate-icons.mjs
├── .env.example
├── ONBOARDING.md               # ⭐ Empieza aquí en tu primera instalación
└── SPRINT-*.md                 # Documentación detallada de cada feature
```

---

## Índice de sprints

Cada sprint trae su propio doc detallado:

| Sprint | Doc | Resumen (≤20 palabras) |
|---|---|---|
| 0 | — | Bootstrap del proyecto Next.js + Supabase con esquema base de memorias, proyectos, entidades y auth por magic link. |
| 1 | [SPRINT-1.md](./SPRINT-1.md) | Motor de captura con embeddings Voyage, búsqueda semántica pgvector y RPC search_memories sobre el grafo inicial. |
| 2 | [SPRINT-2.md](./SPRINT-2.md) | Clasificador LLM que asigna cada memoria a proyectos y entidades del grafo, generando rolling summaries automáticos. |
| 3 | [SPRINT-3.md](./SPRINT-3.md) | Asistente proactivo con feed de pasos siguientes, cache TTL, completion vía botones, generación con Sonnet por proyecto. |
| 4 | [SPRINT-4.md](./SPRINT-4.md) | Vaciado histórico vía entrevistador conversacional dirigido y importador batch de WhatsApp con parser de tres formatos. |
| 5 | [SPRINT-5.md](./SPRINT-5.md) | Captura por voz con OpenAI Whisper o Groq, TTS para preguntas del entrevistador, MediaRecorder con detección de nivel. |
| 6 | [SPRINT-6.md](./SPRINT-6.md) | Fichas enriquecidas de entidad con key_facts, highlights, threads abiertos y co-occurrence; triggers SQL para refresco automático. |
| 7 | [SPRINT-7.md](./SPRINT-7.md) | Digest periódico configurable enviado por email vía Resend, con cron horario, anti-doble-envío y vista web por digest. |
| 8 | [SPRINT-8.md](./SPRINT-8.md) | Búsqueda con filtros ricos, página timeline cronológica con scroll infinito y dashboard de métricas con gráficos SVG. |
| 9 | [SPRINT-9.md](./SPRINT-9.md) | API pública v1 con Personal Access Tokens scoped, gestión en /settings/tokens y export completo del grafo en JSON. |
| 10 | [SPRINT-10.md](./SPRINT-10.md) | Engine de connectors con scheduler, runner end-to-end, webhook inbound público y adapters incluidos para webhooks y RSS. |
| 11 | [SPRINT-11.md](./SPRINT-11.md) | Gmail connector con OAuth Google reutilizable, sync incremental vía History API y refresh on-demand de access_tokens. |
| 12 | [SPRINT-12.md](./SPRINT-12.md) | Drive connector reutilizando el OAuth del Sprint 11, sync incremental vía Changes API y export de Docs/Sheets/Slides. |
| 13 | [SPRINT-13.md](./SPRINT-13.md) | PWA instalable real con service worker, FAB de captura por voz en todas las páginas, onboarding y guía de primer día. |
| 14 | [SPRINT-14.md](./SPRINT-14.md) | Google Calendar adapter con sync incremental syncToken y escritura con safety net "Lexis · Borradores"; user_settings con timezone. |
| 15 | [SPRINT-15.md](./SPRINT-15.md) | Schema `events` + extractor LLM con resolución de fechas relativas + pipeline imagen→eventos con UI preview antes de crear en Calendar. |
| 16 | [SPRINT-16.md](./SPRINT-16.md) | Web Push notifications con VAPID, service worker amplado, sendPush con quiet hours y cleanup automático; settings UI completo. |
| 17 | [SPRINT-17.md](./SPRINT-17.md) | Agente proactivo: 5 reglas preset, cron evaluador cada 5min, executors por tipo, detector LLM de incongruencias antes de crear customs. |
| 18 | [SPRINT-18.md](./SPRINT-18.md) | Bandeja `/inbox` con badge en header, quick replies con efectos directos en el grafo y FAB de respuesta libre por voz dentro del inbox. |

---

## Comandos npm útiles

```bash
npm run dev          # Levantar en desarrollo
npm run build        # Build de producción
npm run start        # Server de producción local
npm run lint         # ESLint
npm run icons        # Regenerar iconos PWA desde public/icon.svg
npm run db:push      # Aplicar migraciones a Supabase
```

---

## Deploy en Cloudflare Pages

1. Push a tu repo de GitHub.
2. Cloudflare Pages → Create project → Connect to Git → seleccionar el repo.
3. Build settings:
   - Framework preset: **Next.js**
   - Build command: `npm run build`
   - Build output directory: `.next`
   - Node version: 20
4. Environment variables: copiar todas las de `.env.local` excepto `NEXT_PUBLIC_APP_URL` (usar tu dominio real).
5. Después del primer deploy: Settings → Cron Triggers (ver sección "Cron jobs").

---

## Filosofía

Lexis es **tuyo**. Tu data en tu Supabase. Sin tracking. Tokens API para que cualquier herramienta (n8n, scripts, otras apps) lea o alimente. Export completo del grafo cuando quieras. Sin lock-in.
