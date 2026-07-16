# Arrancar Lexis en un proyecto Supabase nuevo (org Porcelanosa)

> Objetivo: poner Lexis EN PIE para poder usarlo y enseñárselo a José María.
> Usamos un proyecto Supabase **nuevo y limpio** (el `javiercalero-collab's
> Project` de la org de Porcelanosa) — así NO tocamos el proyecto viejo de la
> cuenta de gmail (que tiene los datos del piloto de Gamadecor).
>
> Tiempo: ~15-20 min. Todo se hace en el dashboard de Supabase + Vercel;
> ninguna credencial pasa por el chat.

---

## Paso 0 · Confirmar que el proyecto está VACÍO

En el proyecto de la org de Porcelanosa → **SQL Editor** → New query → Run:

```sql
select table_name from information_schema.tables where table_schema = 'public';
```

- Si devuelve **0 filas** (vacío) → perfecto, sigue al Paso 1.
- Si devuelve tablas de Lexis (`memories`, `projects`…) → ya está aplicado, salta al Paso 2.
- Si devuelve tablas de OTRA cosa → PARA y avísame (no lo pisamos sin mirar).

## Paso 1 · Aplicar el esquema completo

SQL Editor → New query → **pega el contenido íntegro de**
`docs/lexis-schema-bundle.sql` (las 16 migraciones en orden, ~1460 líneas) →
**Run**. Debe terminar sin error (`Success`). Es idempotente en las extensiones;
si diera un error de "already exists", el proyecto no estaba vacío → Paso 0.

Verifica:
```sql
select count(*) from information_schema.tables where table_schema='public';
-- esperado: ~19 tablas (memories, projects, entities, events, digests, ...)
```

## Paso 2 · Copiar las 3 claves del proyecto

Dashboard → **Project Settings → API**. Apunta:
- **Project URL** (`https://XXXX.supabase.co`)
- **anon / public** key
- **service_role** key (secreta)

## Paso 3 · Repuntar Lexis al proyecto nuevo (Vercel)

En **Vercel → proyecto lexis → Settings → Environment Variables**, actualiza SOLO
las 4 de Supabase (las demás — Voyage, OpenRouter, Resend, OpenAI, VAPID,
CRON_SECRET — NO cambian):

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL del Paso 2 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
| `SUPABASE_URL` (si existe) | Project URL |

> 🔴 **CRÍTICO (bug de login conocido):** las tres `NEXT_PUBLIC_*` deben crearse
> con **"Sensitive" DESACTIVADO**. Si se marcan Sensitive, Vercel NO las inyecta
> en el bundle del cliente y el login manda el magic link a un dominio erróneo
> (404). Si ya existían como Sensitive: **bórralas y recréalas con Sensitive OFF.**

Actualiza también tu `.env.local` local con esas 3 (+ `SUPABASE_URL`) para dev.

## Paso 4 · Redesplegar

Vercel → Deployments → **Redeploy** el último (o `git commit --allow-empty -m
"repoint supabase" && git push`). Sin redeploy, las nuevas variables no entran.

## Paso 5 · Email de acceso (magic link)

Para el PRIMER login basta el SMTP integrado de Supabase (pocos correos/hora, pero
suficiente para entrar tú). Dashboard → **Authentication → Providers → Email**:
asegúrate de que Email está habilitado. (Más adelante, si molesta el límite,
configurar Resend como SMTP custom en Authentication → Emails, como en el proyecto
viejo — sube a 30/h.)

Añade la URL de Vercel a **Authentication → URL Configuration → Site URL** y
Redirect URLs (`https://lexis-henna.vercel.app` y `/**`).

## Paso 6 · Probar

1. Abre `https://lexis-henna.vercel.app` → introduce tu email → llega el magic link → entra.
2. Captura una nota por texto o voz.
3. Comprueba que aparece en el dashboard y que la búsqueda la encuentra.
4. (PWA) En el iPhone: Compartir → Añadir a pantalla de inicio.

Con eso Lexis está VIVO y demostrable. Los connectors de Google (Gmail/Drive/
Calendar) y el cron del digest son Fase 2 — no hacen falta para la demo.

---

## Notas

- **Acta** necesita su PROPIO proyecto Supabase (separado de Lexis). Cuando
  arranquemos Acta, ese es el 2º hueco de la org de Porcelanosa. Lexis + Acta =
  2 proyectos = justo el tope del plan gratuito; por eso el argumento del Pro
  (ver `Justificacion-Supabase-Pro`).
- Si en algún momento conectas la cuenta de Porcelanosa al MCP de Supabase en
  Claude Code, puedo aplicar migraciones y diagnosticar por API directamente,
  sin el paste manual.
