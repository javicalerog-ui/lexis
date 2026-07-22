# Sprint 7 — Digest periódico + email

**Use case desbloqueado**: el cuarto y último del plan original. Lexis te manda por email un snapshot editorial de lo que se movió en tu periodo (semana / quincena / mes), qué decisiones se tomaron, qué llevas parado, qué personas estuvieron centrales y una pregunta abierta que te empuje a la siguiente acción.

No es una bandeja de entrada de notificaciones; es **un mail al lunes** que se lee en dos minutos y deja claro dónde estás.

---

## Qué se ha implementado

### Schema (`supabase_migrations/20260522000005_sprint7_digests.sql`)

Dos tablas:

| Tabla | Para qué |
|---|---|
| `digest_preferences` | Una fila por usuario: `enabled`, `cadence` (weekly/biweekly/monthly), `send_hour_utc`, `day_of_week`, `day_of_month`, `email` (opcional override), `last_sent_at` |
| `digests` | Histórico de todos los snapshots generados: periodo, payload completo, métricas crudas, HTML renderizado, status, `resend_message_id`, errores de envío |

Enums tipados (`digest_cadence`, `digest_status`). RLS habilitado en ambas. Backfill automático: la migración inserta `digest_preferences` para todos los usuarios existentes con defaults (semanal, lunes, 7am UTC = 8am España).

### Generador (`src/lib/digest/generate.ts`)

`generateDigest(supabase, userId, cadence)` recoge en SQL:

- Memorias del periodo (agrupadas por source_type y por día)
- Proyectos tocados (con count de memorias nuevas, su rolling_summary, próximos pasos)
- Decisiones / pasos completados (memorias con `source_metadata.origin = 'next_step_completion'`)
- Proyectos parados (>14 días sin actividad)
- Entidades centrales (>=2 menciones en el periodo, ordenadas por count)
- Memorias destacables (>80 chars, las más recientes)

Esto pasa a Sonnet 4.6 con `DIGEST_PROMPT` (tier deep, JSON mode). El LLM devuelve un payload editorial: `headline`, `overview`, `what_moved`, `decisions`, `stalled`, `people`, `open_question`, `tone_note`.

**Short-circuit**: si el periodo no tiene memorias, no llama al LLM, devuelve un digest "Periodo silencioso" con coste cero.

### Email rendering (`src/lib/digest/render-email.ts`)

HTML inline-styled, compatible con clientes modernos (Gmail, Apple Mail, Outlook web), con la paleta dark + electric blue + violet de Lexis. Incluye:

- Header con marca en gradiente
- Headline card destacada con eyebrow
- Strip de 4 métricas con tipografía display grande
- Secciones (Lo que se movió, Decisiones, Parados, Personas) con dots de color y separadores
- Caja especial para la `open_question` con tipografía itálica Georgia
- CTA "Ver completo en Lexis" linkeado al digest persistido
- Footer minimal
- Plain-text fallback automático para clientes que no renderizan HTML

Todos los colores y tipografías están hardcodeados (no usa CSS variables que muchos clientes de email ignoran).

### Resend adapter (`src/lib/digest/email.ts`)

Llamada simple a `https://api.resend.com/emails`. Acepta tags para filtrar en el dashboard de Resend (`kind=digest`, `cadence=weekly`, `origin=cron`). Sender configurable vía `RESEND_DIGEST_FROM` con fallback a `RESEND_FROM` o `RESEND_FROM_EMAIL` existente.

### API Routes

| Endpoint | Función |
|---|---|
| `POST /api/digest/preview` | Genera y devuelve payload + HTML para preview, sin persistir ni enviar. Útil para iterar sobre el prompt |
| `POST /api/digest/send` | Genera, persiste como `digest`, renderiza HTML, opcionalmente envía vía Resend. Acepta `dry_run: true` para persistir sin enviar |
| `GET /api/digest/[id]` | Trae un digest específico del usuario |
| `GET /api/digest/preferences` | Lee preferencias del usuario (default si no hay fila) |
| `PATCH /api/digest/preferences` | Upsert de preferencias |
| `POST /api/cron/digest` | **Cron job**. Itera sobre `digest_preferences` enabled, comprueba si toca enviar (cadencia + day_of_week/month + hora UTC + anti-doble-envío), genera y manda. Reporta resultados por usuario |

### UI

**`/digest`** (lista):

- Card de configuración (DigestActions client component): selectores en chips minimalistas para cadencia, día y hora UTC. Toggle activo/pausado con dot verde. Email destino editable inline. Botones "Generar preview" y "Enviar ahora".
- Lista de digests históricos con headline + métricas resumidas + pill de status (sent / draft / failed / skipped) y border-left por color.

**`/digest/[id]`** (detalle):

- Layout editorial estrecho (680px) con tipografía display grande.
- Hero con eyebrow + headline en gradiente + overview en prosa.
- Métricas en grid con números grandes.
- Secciones con dots de color (accent / success / warning / violet) por categoría.
- Caja especial para la `open_question` con tratamiento tipográfico distinto (Georgia itálica grande).
- Footer con meta de generación y envío.

### Cron logic (`src/app/api/cron/digest/route.ts`)

Para cada usuario en `digest_preferences`:

1. **enabled?** — sino, skip.
2. **hora UTC** llegó a `send_hour_utc`? — sino, skip "hour_not_yet".
3. **anti-doble-envío**: `last_sent_at` debe ser >= `MIN_DAYS_BETWEEN[cadence]` (6/13/28 días).
4. **día correcto**: weekly/biweekly comparan `day_of_week`, monthly compara `day_of_month`.
5. Si todo OK, genera + persiste + envía + actualiza `last_sent_at`.

El cron es **idempotente por diseño**: aunque se ejecute cada hora, el chequeo de `last_sent_at` impide envíos duplicados. Esto significa que puedes lanzarlo desde cualquier scheduler (Cloudflare Cron Trigger, GitHub Actions, n8n) sin lógica de timing fino.

---

## Decisiones técnicas

1. **Cron hora-a-hora, anti-doble-envío en DB**: en lugar de configurar un cron a las 7:00 UTC específicas, lo ejecutas cada hora y la lógica decide. Esto es robusto frente a downtime: si el cron del lunes 7am falla, el del lunes 8am o 9am todavía envía (porque sigue siendo el mismo día). Si se ejecutara solo a las 7:00 exactas, una caída perdería el envío.

2. **HTML email inline-styled**: nada de CSS modules o variables. Los clientes de email no entienden eso. La paleta y tipografía van duplicadas en `render-email.ts`. Si cambias la paleta en `tokens.css`, hay que recordar actualizar también ese archivo. Aceptable porque el email cambia poco.

3. **Plain-text fallback automático**: Resend lo prefiere y mejora deliverability. Versión condensada con las mismas secciones en formato texto.

4. **Persist-then-render-then-send**: el digest se persiste como `draft` primero, luego se renderiza con su `id` real para el CTA del email, luego se envía. Si el envío falla, el digest sigue en DB con `status='failed'` y `send_error` poblado — puedes verlo desde la UI, regenerar o reenviar manualmente.

5. **`tags` en Resend**: cada envío lleva tags `kind=digest`, `cadence=...`, `origin=cron|manual`. Permite filtrar y monitorizar desde el dashboard de Resend sin parsing.

6. **`preview` ≠ persist**: el endpoint `/api/digest/preview` NO persiste. Útil para iterar sobre el prompt sin llenar la tabla. Si quieres ver el preview en formato UI (no JSON), usa `send` con `dry_run: true` — eso sí persiste pero no envía, y abre la página de detalle.

7. **`generateDigest` separado del envío**: la función no sabe nada de email. Esto facilita reutilizarla para otras superficies en el futuro (push notification, webhook, etc.) sin tocar la lógica de síntesis.

8. **`day_of_month` cap 28**: para evitar bugs en febrero. Si quieres enviar "el último día del mes" eso requeriría más lógica; con 28 cubrimos todos los meses.

---

## Cómo probarlo

Tras aplicar la migración Sprint 7:

### Smoke test 1 — Preview rápido

1. Ir a `/digest`.
2. Pulsar "Generar preview".
3. Te redirige a `/digest/[id]` mostrando el digest persistido como `draft`. Sin email enviado todavía.
4. Verificar que las secciones tienen sentido con tus datos reales del último periodo.

### Smoke test 2 — Envío real

1. En `/digest`, verifica que el email destino es el correcto (puedes editarlo).
2. Pulsa "Enviar ahora".
3. Confirma. La página debería navegar a `/digest/[id]` con status `sent`.
4. Revisa el inbox: debería llegar en <30s vía Resend.
5. Comprueba que el CTA "Ver completo en Lexis" abre `/digest/[id]` correctamente.

### Smoke test 3 — Cron

Una vez que la app esté en producción (Cloudflare Pages con dominio), configurar un Cloudflare Cron Trigger que llame cada hora a:

```bash
curl -X POST https://<tu-dominio>/api/cron/digest \
  -H "Authorization: Bearer <CRON_SECRET>"
```

Verificar:

```sql
-- Ver últimos resultados
select id, period_start, period_end, status, sent_to, sent_at, send_error
from digests
where user_id = '<tu user_id>'
order by generated_at desc
limit 5;

-- Ver preferencias
select * from digest_preferences;
```

### Smoke test 4 — Anti-doble-envío

1. Tras un envío exitoso, ejecutar el cron de nuevo.
2. Tu user_id debería aparecer en `results` con `status: 'skipped', reason: 'recent_send_Xd'`.
3. No se debería crear digest nuevo ni enviarse otro email.

---

## Variables nuevas en `.env.local`

```bash
# Resend (ya tenías RESEND_API_KEY y RESEND_FROM_EMAIL para magic links)
RESEND_DIGEST_FROM=Lexis <digest@tu-dominio.com>   # opcional, fallback a RESEND_FROM_EMAIL

# URL pública para los links del email
NEXT_PUBLIC_APP_URL=https://lexis.tu-dominio.com

# CRON_SECRET ya existe del Sprint 3 (refresh-summaries)
CRON_SECRET=<tu-secret-largo>
```

---

## Inspección SQL útil

```sql
-- Métricas agregadas históricas
select
  cadence,
  count(*) as digests_generados,
  sum((metrics->>'new_memories')::int) as memorias_totales,
  avg((metrics->>'new_memories')::int)::int as memorias_por_digest_avg,
  sum((metrics->>'decisions_count')::int) as decisiones_totales
from digests
where user_id = '<tu uid>'
  and status = 'sent'
group by cadence;

-- Ver el último digest enviado
select
  payload->>'headline' as headline,
  payload->>'open_question' as pregunta,
  metrics,
  sent_at, sent_to
from digests
where user_id = '<tu uid>'
  and status = 'sent'
order by sent_at desc
limit 1;

-- Healthcheck del cron: ¿cuándo se envió el último?
select user_id, last_sent_at, cadence
from digest_preferences
where enabled = true;
```

---

## Pendiente / posibles Sprint 8+

- **Streaming SSE en preview**: para que las secciones aparezcan progresivamente mientras Sonnet genera.
- **Tabbed comparison de digests**: "ver semana actual vs semana pasada lado a lado".
- **Webhook de Resend para tracking**: marcar `opened_at`, `clicked_at` cuando el email se abra/se haga click.
- **Templates múltiples**: digest "ejecutivo" (lo que hay ahora) vs digest "íntimo" (más personal, menos métricas, más reflexión).
- **Digest on-demand por proyecto**: "dame el digest solo de Polonia este mes".
- **Cron Trigger de Cloudflare Pages**: documentar el setup del `wrangler.toml` con `[triggers]` para schedule.

---

## Checklist de cierre Sprint 7

- [ ] Migración `20260522000005_sprint7_digests.sql` aplicada.
- [ ] `RESEND_DIGEST_FROM` configurada (o `RESEND_FROM_EMAIL` reutilizable) y dominio verificado en Resend.
- [ ] `NEXT_PUBLIC_APP_URL` configurada con la URL pública real.
- [ ] `/digest` muestra DigestActions con cadencia/día/hora editables.
- [ ] "Generar preview" persiste un digest draft y navega al detalle.
- [ ] "Enviar ahora" entrega email a la bandeja y persiste `status='sent'` con `resend_message_id`.
- [ ] El email se ve bien en Gmail/Apple Mail (dark theme respetado, colores correctos, CTA funcional).
- [ ] `/digest/[id]` muestra headline + métricas + secciones editoriales.
- [ ] Tras enviar, "Enviar ahora" otra vez en el mismo periodo no genera duplicado por el anti-doble-envío del cron (cuando llegue el cron real).
- [ ] Botón ✉ en el header del chat principal lleva a `/digest`.
- [ ] Cron Trigger configurado en producción apuntando a `/api/cron/digest` cada hora con `CRON_SECRET`.
