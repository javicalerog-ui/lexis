# Prompt de auditoría externa — Lexis (2026-09-08)

Prompt listo para pegar en otro modelo/herramienta de IA con acceso de lectura al sistema de ficheros (Claude Code, Cursor, Windsurf, Gemini CLI, Codex CLI...). Pide auditoría de solo lectura: no debe modificar código.

---

## PROMPT (copiar desde aquí)

Vas a auditar en profundidad el repositorio de una aplicación en producción. Busca **bugs reales** (correctness, seguridad, fugas de datos) y plantea **mejoras** (rendimiento, robustez, deuda técnica), con evidencia verificada contra el código — nunca por suposición.

**Regla de trabajo: NO modifiques ningún fichero. Auditoría de solo lectura.** Si algo requiere probarlo en ejecución, dime los pasos en vez de ejecutarlos tú.

### 1. Qué es esta app

**Lexis** es una PWA personal ("segundo cerebro") que captura información por voz/texto/conectores (Gmail, Drive, Calendar, RSS), la convierte en memorias con embeddings vectoriales, y permite recuperarla por búsqueda semántica con respuestas citadas. Incluye agenda con recordatorios push, digest semanal por email, un grabador/transcriptor de reuniones (Acta/Scriba) y conectores externos.

- **Ruta del repo:** `C:\Users\ES00500148\Desktop\Proyectos IA\10-lexis-segundo-cerebro\`
- **Producción:** https://lexis-jade.vercel.app (Vercel, plan Hobby)
- **Stack:** Next.js 14 (App Router) + React 18 + TypeScript · Supabase (Postgres+Auth+Storage, proyecto `cvtbzxeizdaihyitbphh`, org Porcelanosa) con `@supabase/ssr` y `@supabase/supabase-js` · Voyage AI para embeddings (pgvector) · OpenRouter para el LLM (Gemini/Claude vía escalada) · OpenAI Whisper+TTS para voz · Resend para email (hoy en modo sandbox) · VAPID para push notifications.
- **Usuario actual:** uso personal diario de un único usuario (Javier Calero), instalada como PWA en iPhone.
- **⚠️ CONTEXTO CRÍTICO PARA LA AUDITORÍA — transición en curso a multiusuario:** la app está en proceso de absorber un segundo usuario real (un ejecutivo senior, acceso por contraseña, con datos de negocio propios y una vista de UI simplificada). Esto significa: **cualquier hallazgo del tipo "no importa porque solo hay un usuario" está OBSOLETO** — trátalo como si ya hubiera 2+ usuarios con datos que no deben cruzarse. Lee el plan completo en `docs/PLAN-MIGRACION-CLAVIS-LEXIS.md` (mismo repo) para entender hacia dónde va la arquitectura — no hace falta auditar ese plan, pero sí tenerlo en cuenta para no señalar como "innecesario" algo que el plan ya identificó como requisito (rol admin, RLS multiusuario, aislamiento del bucket de Storage, etc.).

### 2. Qué leer (en este orden)

1. `package.json` — versiones exactas de dependencias, scripts.
2. `src/middleware.ts` + `src/lib/supabase/middleware.ts` — qué rutas exigen sesión y cuáles quedan exentas.
3. `src/app/auth/**` — login (contraseña + magic link), callback. Comprueba si `signInWithOtp` permite auto-registro (`shouldCreateUser`).
4. `supabase_migrations/*.sql` completas, en orden cronológico — cada tabla, cada política RLS, cada función/RPC. Presta atención a: (a) toda tabla que NO tenga `user_id` o RLS explícita — justifica por qué; (b) funciones `SECURITY DEFINER` vs `SECURITY INVOKER`; (c) cualquier RPC que reciba un `p_user_id`/`p_*_id` como parámetro y compruébalo contra `auth.uid()` — si no lo contrasta, es una fuga potencial.
5. `docs/lexis-schema-bundle.sql` si existe — compáralo contra las migraciones más recientes; puede estar desactualizado.
6. `src/app/api/**/route.ts` — los ~44 endpoints. Para cada uno verifica: ¿autentica? ¿usa `createServiceClient` (bypassa RLS) quién puede llamarlo? ¿valida el body/query? ¿hay rate limiting donde debería haberlo (auth, envío de mensajes, IA)? ¿maneja errores sin filtrar detalles internos al cliente?
7. `src/app/api/cron/**` — quién los protege (revisa el secreto/cabecera), qué pasa si se llaman dos veces seguidas (idempotencia), qué pasa si fallan a medias.
8. `src/lib/supabase/server.ts` y `client.ts` — dónde se crea cada tipo de cliente (anon/service role) y quién importa el de service role.
9. Subida de ficheros: busca todos los usos de Supabase Storage (`.storage.from(...)`, `getPublicUrl`, `createSignedUrl`) — el bucket principal es `lexis-raw`. Verifica: ¿el path incluye `user_id`? ¿usa URL pública o firmada? ¿el bucket tiene política RLS de Storage o es público?
10. `src/lib/llm/**` y `src/lib/answer/**` — la capa de LLM y de síntesis RAG. Revisa: prompt injection desde contenido capturado externamente (emails, RSS, documentos), inyección de system prompt, límites de tokens/coste, manejo de fallos del proveedor.
11. `src/lib/events/extractor.ts` y `src/app/api/cron/reminders/route.ts` — extracción de fechas/recordatorios y su disparo.
12. `src/lib/digest/**` — generación y envío del resumen semanal.
13. Conectores externos (Gmail/Drive/Calendar/RSS) — busca `connector_credentials` o similar: ¿cómo se guardan los tokens OAuth? ¿en claro o cifrados?
14. `public/manifest.json` y `public/sw.js` — estrategia de caché del Service Worker (¿puede servir contenido desactualizado o de otro usuario tras un cambio de sesión?).
15. Cualquier carpeta `tests/` — qué cobertura real existe, especialmente sobre lo anterior.
16. Ficheros de configuración de despliegue (`vercel.json`, `.env.example`) — qué límites de plan (crons, duración de función) pueden estar mordiendo funcionalidad real.

### 3. Focos de riesgo conocidos a verificar (no des nada por hecho; confirma estado actual)

Estos son hallazgos de una auditoría interna del 2026-09-07 — puede que ya estén corregidos o que hayan cambiado. Verifícalos contra el código actual y repórtalos con su estado real:

- El login por enlace mágico (`src/app/auth/login/page.tsx`) podía crear cuentas nuevas automáticamente si el proyecto Supabase permite signups (sin `shouldCreateUser:false`).
- El bucket `lexis-raw` tenía al menos dos subidas con rutas sin `user_id` (`src/app/page.tsx`, `src/app/import/page.tsx`) y otra que sí usaba `user_id` en el path pero luego generaba una URL pública (`FloatingVoiceCapture.tsx`).
- Al menos 6 funciones RPC (`user_activity_buckets`, `user_metrics_snapshot`, `upcoming_events`, `pending_actions_count`, `entity_cooccurrence`, `list_connectors_with_stats`) aceptaban un `p_user_id` sin contrastarlo explícitamente contra `auth.uid()` (mitigado por `SECURITY INVOKER` + RLS, pero fragilísimo ante un futuro cambio a `SECURITY DEFINER`).
- No existía ningún concepto de rol/admin en el código.
- La síntesis RAG (`/api/answer`) era mono-turno y sin historial persistente — cualquier conversación se perdía al recargar.
- El digest semanal se activa por defecto (`enabled=true`) para todo usuario nuevo, y depende de Resend en modo sandbox (fallaría para cualquier email que no sea el de la cuenta principal).
- Tokens OAuth de conectores potencialmente en texto plano en `connector_credentials`.
- Posible SSRF en el adaptador RSS (sin bloqueo de IPs privadas).
- Dependencia `xlsx@0.18.5` con CVE conocida (uso client-side).

### 4. Qué NO hace falta

- No propongas cambiar el stack (Next.js/Supabase/Vercel) — es una decisión ya tomada y estable.
- No repitas como "hallazgo" algo que ya está explícitamente documentado y aceptado como decisión de diseño en el propio código (comentarios) o en `docs/PLAN-MIGRACION-CLAVIS-LEXIS.md` — en ese caso, solo señálalo si crees que la decisión documentada es en sí misma incorrecta, y explica por qué.
- No hace falta que ejecutes la app ni el build; si quieres proponer una prueba en ejecución, dame el comando y qué esperar, y la corro yo.

### 5. Formato de salida

Un hallazgo por bloque, ordenados por severidad (Crítico → Alto → Medio → Bajo → Mejora), con:

```
### [SEVERIDAD] Título corto del hallazgo
**Categoría:** seguridad | bug de correctness | rendimiento | UX | deuda técnica
**Fichero:línea:** ruta relativa exacta
**Qué pasa:** descripción técnica precisa
**Escenario de fallo:** input/estado concreto → consecuencia concreta (no genérica)
**Fix propuesto:** cambio concreto, con nombre de fichero si aplica
```

Cierra con un resumen ejecutivo de 5-8 líneas: qué tan grave es el estado general, y cuáles 3 hallazgos arreglarías primero si solo pudieras arreglar 3.
