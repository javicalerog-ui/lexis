# Plan de migración Clavis → Lexis unificado

> **Decisión de Javi, 2026-09-07.** Una sola app (Lexis) para Javi y Silvestre Segarra. Clavis se apaga por completo como última fase. Este documento es la fuente de verdad del plan; el estado vivo de Lexis sigue en su dossier/memoria.
>
> Basado en auditoría multi-agente de 2026-09-07 sobre los repos reales de Lexis, Clavis y silvestre-gpts (5 lectores + síntesis; cada afirmación técnica lleva fichero:línea verificado ese día).

## 0. Decisiones cerradas (contrato de arranque)

| # | Decisión | Detalle |
|---|---|---|
| 1 | Una sola app: **Lexis** | Next.js 14 + Supabase `cvtbzxeizdaihyitbphh` (org Porcelanosa) + Vercel `lexis-jade.vercel.app` |
| 2 | Acceso de Silvestre | Cuenta propia + **contraseña** (login ya construido). Alta SIN email desde el Dashboard (esquiva Resend sandbox). |
| 3 | **Modo Silvestre** | Vista simplificada de UNA pantalla de chat, sin pestañas; guard de rutas obligatorio. Javi conserva el Lexis completo. |
| 4 | Motor de datos → **Postgres/Supabase** | Las ~119.750 filas de Clavis (8 tablas + vista `ventas_pais`) pasan a un schema dedicado. Revierte DuckDB/R2 (decisión explícita 07-09). |
| 5 | Carga periódica | **Script local** `cargar_supabase.py` adaptado del pipeline silvestre-gpts; los 7 `build_*` NO se tocan. |
| 6 | Javi = **admin** | Ve datos y conversaciones de ambos, vía rol en `app_metadata` + rutas `/api/admin/*`. |
| 7 | **Clavis se apaga por completo** | ÚLTIMA fase, solo tras validación de Lexis con Silvestre en persona. |
| 8 | GPTs | Los 5 GPTs conviven hasta esa validación; luego se retiran. |
| 9 | **Memoria conversacional de Silvestre — captura-todo por defecto** *(añadido 07-09, ampliado 08-09)* | Su chat PERSISTE historial completo y, ADEMÁS, **todo mensaje se embebe automáticamente en `memories`** (no solo lo que el router clasifique como "guardar"): el router pasa de gatekeeper a enriquecedor (añade tags/importancia/entidades), nunca decide si algo es o no buscable. Así un fallo de clasificación no vuelve nada irrecuperable — solo pierde etiquetado fino, no la respuesta a "¿qué te dije sobre X?". No hay historial de Clavis que migrar: nunca se usó. |
| 10 | **Agenda con notificaciones — confirmación obligatoria** *(añadido 07-09, ampliado 08-09)* | Recordatorios programables con notificación push emergente a su hora. El motor YA existe en Lexis (`/api/cron/reminders` + extractor + latido Worker Acta cada 15 min) pero nunca se encendió: falta migración `notified_at` + suscripciones push en los iPhone. **A diferencia de la memoria, un recordatorio SÍ depende del router (es accionable, no descriptivo): por eso el asistente SIEMPRE confirma visiblemente en el chat cuando cree haber creado uno ("📅 Anotado: te recuerdo el lunes a las 9"). Ausencia de esa confirmación = señal para que Silvestre lo repita.** Sin esto, un fallo de clasificación de recordatorio SÍ es pérdida real (nunca sonará el aviso). |
| 12 | **Conocimiento de empresa compartido** *(añadido 08-09)* | Javi quiere registrar mucha info de la empresa; parte es solo suya y parte debe verla también Silvestre. Hoy las `memories` son estrictamente por-usuario (RLS user_id). Falta una función NUEVA: memorias con visibilidad "compartida/empresa" que ambos usuarios puedan buscar desde su chat. Diseño previsto: columna `visibility` ('private'\|'shared') en memories + política RLS que deje leer las shared a cualquier usuario permitido + la búsqueda RAG incluye las shared + en Importar poder marcar un lote como compartido. Los DATOS numéricos NO van aquí (van al motor `datos`, que ya es compartido por naturaleza). Pendiente de construir; no bloquea que Javi importe sus documentos personales ya. |
| 11 | **Chat unificado sin modos PARA LOS DOS** *(añadido 08-09, ampliado a Javi el mismo día)* | Un ÚNICO input sin pestañas Capturar/Buscar: el router de intenciones (patrón Clavis validado) decide datos/recordatorio/charla y enriquece la memoria (nunca decide SI se guarda, ver decisión 9). Silvestre: es toda su app — **sin segunda pantalla de Capturar** (el captura-todo de la decisión 9 + la confirmación de la 10 cubren el riesgo sin reintroducir multipantalla, que fue el motivo original de descartar Clavis). Javi: mismo chat como home, pero CONSERVANDO su cabecera completa de navegación y todas sus pantallas. Orden: primero se valida con las pruebas de Fase 4, luego se activa el home de Javi. El componente Capturar/Buscar actual queda detrás de un flag como rollback tuyo (motivo distinto: red de seguridad ante bugs del router en tu flujo diario ya establecido, no compensación de este riesgo). |
| — | Ficha de Silvestre | Se ingesta con el criterio firme ya validado: **párrafo judicial y vida personal/religiosa EXCLUIDOS** (RGPD art. 10). |

## 1. Resumen ejecutivo

Lexis ya es multiusuario a nivel de datos (RLS `auth.uid()=user_id` en ~25 tablas, crons que iteran por usuario, login por contraseña construido en `src/app/auth/login/page.tsx`), pero mono-usuario a nivel de producto: no existe rol admin, ni modo simplificado, ni chat persistente. El motor de Clavis (~119.750 filas DuckDB→R2, validador SQL, prompts de negocio) se porta a un schema Postgres propio en el Supabase de Lexis con rol de solo lectura, porque el aislamiento físico del fichero DuckDB desaparece y no puede sustituirse solo con el validador textual. El plan tiene 9 fases: salvaguarda, cierre de seguridad, port de datos, capa de consulta, modo Silvestre (chat + memoria + agenda), vista admin, SOP mensual, validación en persona, y apagado de Clavis — este último SIEMPRE el final y solo tras validar con Silvestre, momento en que también se retiran los 5 GPTs.

---

## 2. Fases

### Fase 0 — Salvaguarda y verificación del estado real (esfuerzo: M)

**Objetivo:** ninguna pérdida irreversible y ninguna suposición sin verificar antes de tocar nada.

**Tareas:**
- Exportar el informe personal de Silvestre — ÚNICA copia, gitignoreada, nunca ingerida en BD: `C:\Users\ES00500148\Desktop\Proyectos IA\05-ia-encargos-grupo\clavis\deep-research-report_Silvestre-Segarra_completo.md` (47.189 bytes) + versión corta (1.462 bytes) → paquete de export en el workspace. Marcar en el paquete la exclusión firme del párrafo judicial y vida personal/religiosa de cualquier re-ingesta (RGPD art. 10, DOSSIER §3). (S)
- Exportar la BD Supabase de Clavis `fabuvregksslptafjbko` (8 tablas: users, magic_link_tokens, chat_sessions, chat_messages, reminders, memories, push_subscriptions, cron_state) vía pg_dump por el pooler 6543; verificar recuentos contra la app; comprobar antes que el proyecto está ACTIVE (el tope de 2 activos pausa sin avisar). Guardar en workspace, nunca Downloads. (M)
- Asegurar el datamart local `clavis\apps\api\_datamart\clavis-datos.duckdb` (3,4 MB, snapshot 17-08); validación rápida: `SUM(eur)` ventas_pais Francia 2025 = 56.953.780,72. Copiarlo al paquete. (S)
- Auditar el Dashboard de Supabase de LEXIS (`cvtbzxeizdaihyitbphh`): toggle "Allow new users to sign up", si el bucket `lexis-raw` es público, y qué migraciones están aplicadas (el bundle `docs/lexis-schema-bundle.sql` es de 2026-07-16 y hay 3 migraciones posteriores: 20260722, 20260723, **20260727 events_notified_at — imprescindible para la agenda, decisión 10**). Estado NO verificable desde el repo → PENDING hasta esta auditoría. (S)
- Test de conectividad desde la red corporativa: Postgres directo (5432/6543) vs fallback PostgREST/HTTPS 443 — el proxy 172.22.1.121:8080 ya rompe fetch de Node y wss. El resultado condiciona el diseño del cargador (swap atómico transaccional vs tabla espejo + RPC de swap). (S)

**Hecho cuando:** paquete de export verificado en el workspace (informe + dump + duckdb), checklist del Dashboard de Lexis anotada, y resultado del test de conectividad documentado.

---

### Fase 1 — Cierre de seguridad y cuentas en Lexis (esfuerzo: M)

**Objetivo:** Silvestre puede entrar, nadie más puede auto-registrarse, Javi es admin de forma no falsificable, y no hay fugas entre usuarios.

**Tareas:**
- Alta de Silvestre SIN email: Supabase Dashboard → Authentication → Add user con contraseña + Auto Confirm (o `auth.admin.createUser({email, password, email_confirm:true})` con service role). Entra directo por la pestaña "Contraseña" de `src/app/auth/login/page.tsx:49`. Esquiva Resend sandbox y SMTP de Supabase. (S)
- Cerrar el signup abierto: añadir `shouldCreateUser:false` al `signInWithOtp` de `src/app/auth/login/page.tsx:35` + desactivar signups en el Dashboard. Con 2 usuarios reales es obligatorio, no higiene. (S)
- Rol admin vía `app_metadata.role='admin'` para Javi (Admin API, one-shot) + helper `src/lib/auth/admin.ts` con `requireAdmin()`. NUNCA en `user_settings`: su PATCH lo escribe el propio usuario. (S)
- Flag `ui_mode='simple'` para Silvestre en `app_metadata` (viaja en el JWT, legible en middleware sin query extra), opcionalmente duplicado como columna en `user_settings` (patrón `20260523000000_sprint14_user_settings.sql`). (S)
- Insertar `digest_preferences.enabled=false` para Silvestre al darlo de alta (el default es `enabled=true`, `sprint7_digests.sql:20`, y con Resend en sandbox el envío semanal a ssegarra@ fallaría). (S)
- ~~Migración de hardening de las 6 RPC `p_user_id` pendientes~~ — **REVISADO 08-09, auditoría externa: riesgo sobrevalorado.** Son `SECURITY INVOKER` (RLS sigue aplicando pase lo que pase con el parámetro) y `entity_cooccurrence` ni siquiera recibe `p_user_id`. Degradado a mejora de bajo rango, no bloqueante. (S, opcional)
- **🔴 NUEVO P1 (auditoría externa 08-09, verificado línea por línea) — fuga e inyección cruzada por enlaces `memory_projects`/`memory_entities` sin validar el propietario del otro extremo:** las políticas RLS (`20260522000000_initial_schema.sql:193-201`) solo comprueban que la memoria es tuya; el `project_id`/`entity_id` puede ser de OTRO usuario si conoces el UUID. Dos explotaciones confirmadas: (a) **fuga de metadatos** — `src/lib/search/filters.ts:84-92` (`enrichMemories`, llamado desde `/api/v1/search` vía PAT con cliente service role) no filtra propietario al hacer el JOIN, así que un enlace cruzado revela nombre/slug/tipo del proyecto/entidad ajeno; (b) **inyección de prompt entre usuarios, MÁS GRAVE que (a):** `src/lib/projects/refresh-summary.ts:69-74` y `src/lib/entities/refresh-summary.ts:48-54` (llamados por el cron `refresh-summaries` con service role, sin intervención del atacante) agregan el contenido de memorias enlazadas sin comprobar propietario — el contenido de A puede acabar redactado dentro del `rolling_summary` del proyecto de B, que B lee como si fuera su propio resumen ejecutivo generado por IA. Con Silvestre y Javi compartiendo el mismo Postgres, es el escenario exacto que la Fase 1 pretendía cerrar. **Fix:** añadir `user_id` a `memory_projects`/`memory_entities` con FK compuesta o trigger que valide mismo propietario en ambos extremos antes de insertar; pasar `userId` a `enrichMemories` y a las queries de `refresh-summary.ts` y filtrar explícitamente; sanear enlaces cruzados existentes antes de aplicar la restricción. **BLOQUEANTE de Fase 1** — no cargar datos de negocio ni activar el PAT/API v1 para dos usuarios reales sin esto corregido. (M)
- **🟠 NUEVO P2 (auditoría externa 08-09, verificado) — muestreo arbitrario en "últimas memorias" de los resúmenes automáticos:** `projects/refresh-summary.ts:73` ordena por `memory_id` (UUID, no fecha) antes de cortar en 40; `entities/refresh-summary.ts:53-54` corta en 80 SIN order previo. Con más enlaces que el límite, el resumen de IA se construye sobre una muestra aleatoria, no las más recientes — puede omitir decisiones importantes recientes. **Fix:** filtrar `status='active'` y ordenar por `captured_at desc` en la query SQL antes del `LIMIT`, no después en memoria. (S)
- Aislar el bucket `lexis-raw`: verificar si es público (PENDING de Fase 0); migración con políticas por carpeta `auth.uid()` estilo `acta_tables.sql:190+`; cambiar los 2 paths planos sin user_id (`src/app/page.tsx:102`, `src/app/import/page.tsx:119`) a `${user.id}/...`; sustituir `getPublicUrl` por `createSignedUrl` en `src/components/voice/FloatingVoiceCapture.tsx:104` y adaptar `/events/preview`. (M)

**Hecho cuando:** Silvestre inicia sesión con contraseña en prod; un email ajeno NO puede crearse cuenta por magic link; un test manual con la sesión de Silvestre no puede leer memorias/ficheros de Javi ni viceversa; el flag admin de Javi está en `app_metadata`; **un intento deliberado de enlazar una memoria propia a un `project_id`/`entity_id` ajeno falla en la BD (constraint), y si ya existieran enlaces cruzados de antes de la fase, están saneados.**

---

### Fase 2 — Port del motor de datos: schema Postgres + cargador local (esfuerzo: L)

**Objetivo:** las ~119.750 filas de Clavis viven en Postgres de Lexis con paridad verificada y semántica intacta.

**Tareas:**
- Migración SQL en `supabase_migrations\`: schema dedicado (`datos`/`negocio`) con las 8 tablas + vista `ventas_pais` (SQL portable casi literal de `build_datamart.py:351-368` y `:386-404`). Trasladar los `COMMENT ON TABLE` del dict COMENTARIOS (`build_datamart.py:244-301`): son la semántica anti-mentira (perímetro exportación directa vs filiales, hueco Ascer jul-2025, cortes desiguales por fuente). Tipos NUMERIC(18,2) para eur/mt2 (evita el problema de `round()` sobre double en Postgres); índices en (pais_norm, anio), (periodo), (fuente). SIN RLS por user_id: son datos de empresa — lectura por allowlist (claim de rol o tabla members con los 2 uuids), escritura solo service role. (M)
- Rol Postgres `clavis_datos_ro` con GRANT solo sobre el schema de datos (cero privilegios sobre public/auth) + RPC/conexión de ejecución con `SET LOCAL default_transaction_read_only=on`, `statement_timeout='4s'`, `search_path=datos` y envoltura `SELECT * FROM (…) LIMIT 200` (equivalente a `datamart.py:116`). Es REDISEÑO, no port: en Clavis el aislamiento era físico (fichero aparte read_only); aquí la lista blanca textual sola NO basta. (M)
- `cargar_supabase.py`: copiar (NO importar — `build_sociedad.py` ejecuta el build a nivel de módulo) las funciones pandas de `clavis\apps\api\scripts\build_datamart.py` (tabla_*, norm, mes_num, periodo, ALIAS_PAIS); mismo punto de la cadena (lee los 5 Excel de `silvestre-gpts\data\`); sink nuevo: staging + swap atómico + verificación (count por tabla == len(df), SUM(eur) por año al céntimo, periodo_max por serie, 0 pais_norm NULL; espíritu de `verify()` de `actualizar-todo.py:61-86`). No tocar los 7 build_* ni `actualizar-todo.py`. Desaparecen las dependencias duckdb/R2/boto3/datamart_sync. (M)
- Validación de paridad contra el DuckDB congelado: totales eur/mt2 por tabla y año, cobertura por fuente, Francia 2025 = 20,6 + 36,4 = 56,9 M€ por canal, precios medios ~23/16/10 €/m². (S)

**Hecho cuando:** carga completa re-lanzable sin error, agregados de control idénticos al DuckDB del 17-08, `COMMENT ON` presentes en Postgres, y una consulta con el rol restringido a `public.memories`/`auth.users` falla por PRIVILEGIOS.

---

### Fase 3 — Capa de consulta segura y chat de datos (esfuerzo: L)

**Objetivo:** el pipeline pregunta→SQL→respuesta de Clavis funciona en Lexis con las mismas garantías, adaptado a Postgres.

**Tareas:**
- Portar `validar_sql()` (`clavis\apps\api\clavis_api\services\datamart.py:83-107`) a `src\lib\datos\validar-sql.ts`: mismas fases; quitar léxico DuckDB (read_csv, attach, pragma…) y añadir el de Postgres (pg_sleep, pg_read_file, pg_ls_dir, dblink, lo_import, copy, do, execute, grant, lock…) + bloquear pg_catalog/information_schema. Portar `resultado_vacio()` (`datamart.py:171-183` — SUM sin filas devuelve 1 fila NULL, incidente "Francia 2025") y `formatear_resultado()`. (S)
- Portar `datos_qa.py` a `src\lib\datos\qa.ts`: `_SQL_PROMPT` y `_RESPUESTA_PROMPT` (`:18-144`) casi verbatim cambiando "SQL de DuckDB"→"SQL de PostgreSQL"; `_limpiar_sql`, centinela IMPOSIBLE→null, y `_con_contexto` (arrastre de 4 turnos, `:182-204` — sin él los seguimientos pierden el filtro de país y devuelven totales mundiales: documentado como el error más peligroso). Temperature=0 sobre la capa LLM de Lexis. (M)
- Generador de esquema para el prompt: equivalente de `esquema_texto()` (`datamart.py:127-168`), o mejor generado por el cargador y congelado en una tabla `dim_esquema` (el runtime no necesita privilegios de catálogo). (S)
- Integrar la intención 'datos' en el clasificador existente de Lexis (`src\lib\classifier`), con el matiz de `intent.py:28-29` (preguntar POR las fuentes es 'datos') y los dos comportamientos de `chat.py`: degradación honesta si el motor no responde (`:246-252`) y fallback consultar→datos (`:287-301`). Activa para Silvestre y para Javi-admin. (M)
- Portar la personalidad `clavis\apps\api\clavis_api\prompts\system_v1.md` al modo Silvestre ACTUALIZANDO "Capacidades y limitaciones": la línea "No tienes cargados sus archivos de ventas" (`:78`) queda falsa tras el port y haría negar el motor (mismo bug que forzó el fallback del commit 8b46256). El system prompt de Javi no se toca. (S)
- Reconstruir la suite de ataques como tests versionados en `tests\`: la "24/24" citada en `clavis\docs\GUIA-DATOS-R2-2026-08-12.md:9` NO existe como código (verificado en git log de 69 commits) — DML/DDL, multi-sentencia, CTE mutante, pg_sleep/pg_read_file/dblink/lo_import, lectura de catálogos y tablas de Lexis, bypass mayúsculas/unicode, positivos legítimos (ROLLUP, ILIKE), + los 5 casos funcionales de la "prueba de fuego". (M)

**Hecho cuando:** la suite completa pasa en verde contra el validador Y contra el rol restringido; las 5 preguntas de fuego (Francia 2025, precio medio 3 fuentes, cuota con advertencia de perímetro, ramos de compras, "Marte"→sin dato) responden correctamente con la BD cargada.

---

### Fase 4 — Modo Silvestre: chat persistente + memoria + agenda (esfuerzo: L)

**Objetivo:** Silvestre ve UN chat, nada más, por ninguna vía; lo que cuenta se recuerda (decisión 9); puede pedir recordatorios que le avisan a su hora (decisión 10); Javi conserva el Lexis completo.

**Tareas:**
- Bifurcar el home server-side: extraer `src/app/page.tsx` actual a `src/components/home/FullHome.tsx` y convertir page.tsx en server component que renderice FullHome o AssistantChat según ui_mode (sin flash cliente). Toda la navegación a ocultar vive en un solo fichero: `src/app/page.tsx:234-292` (tabs Capturar/Buscar + ~13-14 links + logout). (M)
- **Home unificado también para Javi (decisión 11):** tras pasar las pruebas del router con el modo Silvestre, el home de Javi renderiza el MISMO AssistantChat en el área central (sustituye a las pestañas Capturar/Buscar) manteniendo intacta su cabecera de navegación y todas sus pantallas. FullHome (Capturar/Buscar actual) NO se borra: queda detrás de un flag (`ui_home='chat'|'classic'` en user_settings) como rollback inmediato si el router clasifica mal capturas reales de su día a día. (S)
- Chat persistente clonando el blueprint de la Entrevista: migración `assistant_sessions`+`assistant_messages` (calcada de `20260522000003_sprint4_interviews.sql`, RLS own-row); endpoint `src/app/api/assistant/route.ts` (persiste turnos, recupera últimos N, GET para hidratar); componente reusando `ChatInput.tsx` (ya con voz) y el render de `MessageList.tsx`; extender `chat()` en `src/lib/llm/escalation.ts` para aceptar historial (hoy solo envía system+user, `:20-21`; `/api/answer` es mono-turno y efímero). El chat llama al router de Fase 3 (memorias vs datos) — sin él respondería siempre "no está en tu memoria". (L)
- **Captura-todo por defecto, router como enriquecedor, no gatekeeper (decisión 9, ampliada 08-09):** CADA turno de Silvestre se embebe automáticamente en `memories` (llamada a Voyage + insert, en paralelo al guardado del turno en `assistant_messages` — no condicionado a la intención detectada). El router (`intent.py` portado) sigue clasificando la intención para decidir la RESPUESTA (datos/recordatorio/agenda/cancelar/charla) y para enriquecer la memoria ya guardada con tags/entidades/importancia, pero NUNCA decide si algo se guarda. Efecto: un fallo de clasificación degrada la calidad del etiquetado, nunca la recuperabilidad — la pregunta "¿qué te dije sobre X?" sigue encontrándolo. Volumen bajo (uso personal): coste extra de embeddings despreciable. (M)
- **Intent `recordatorio` con confirmación obligatoria (decisión 10):** crear `events` type reminder con due_at (el extractor `src/lib/events/extractor.ts` ya sabe hacerlo desde capturas) + intent `agenda` (listar próximos) y `cancelar` (desambiguación 1→cancela / varios→pregunta, patrón Clavis). A diferencia de la memoria, ESTE intent sí es crítico: si el router no lo detecta, el evento nunca se crea. Por eso el asistente SIEMPRE responde con confirmación visible y explícita ("📅 Anotado: te recuerdo el lunes a las 9") cuando actúa sobre un recordatorio — su ausencia es la señal para que Silvestre repita el mensaje. (M)
- **El chat de Silvestre NO tiene pestañas ni modos (decisión 11):** un único input; el captura-todo + la confirmación de recordatorios cubren el riesgo de pérdida sin reintroducir una segunda pantalla (que fue el motivo original de descartar Clavis). Cada acción no-conversacional se confirma en el chat ("✓ Guardado", "📅 Anotado"), imprescindible para que un usuario senior confíe en que la app le escuchó.
- **Encender la agenda de notificaciones (decisión 10):** confirmar aplicada la migración `20260727120000_events_notified_at.sql` (Fase 0); verificar que el latido del Worker de Acta llama a `/api/cron/reminders` en prod con el CRON_SECRET; activar la suscripción push de Javi (permiso de notificaciones desde la PWA — hoy `push_subscriptions` está a 0 y por eso nunca sonó nada); vista mínima de "próximos recordatorios" dentro de la ventana única de Silvestre. La suscripción de Silvestre se hace en la Fase 7, con su iPhone delante. (M)
- Guard en `src/lib/supabase/middleware.ts` (tras línea 29): si `ui_mode==='simple'` y pathname ∉ {'/', '/auth/*', públicos}, redirigir a '/'. Imprescindible: ocultar tabs no basta, todo es accesible por URL directa y por los shortcuts del manifest (/meetings, /timeline, /feed). Mantener accesibles solo los /api/* que el modo simple usa. (S)
- Bump de `CACHE_VERSION` en `public/sw.js` al desplegar (el shell '/' está cacheado network-first; una PWA instalada serviría el shell viejo). Manifest único compartido: no requiere cambios. Mantener el chat de Silvestre en '/' (FloatingVoiceCapture ya está oculto ahí vía HIDDEN_PATHS). (S)
- Ingesta de la ficha de Silvestre (del paquete de Fase 0) a su memoria, EXCLUYENDO párrafo judicial y vida personal/religiosa. (S)

**Hecho cuando:** con la cuenta de Silvestre: solo se ve el chat (cero icon-links), cualquier deep-link o shortcut redirige a '/', el historial sobrevive a recargar, una pregunta de negocio real devuelve cifra correcta con formato ejecutivo, "recuérdame X mañana a las 9" crea el evento Y muestra la confirmación visible, la push llega a su hora, "¿qué te dije sobre X?" recupera lo dicho en chats anteriores, **y — prueba específica del captura-todo — un mensaje deliberadamente ambiguo que el router clasifique como charla sigue siendo recuperable por búsqueda semántica** (verifica que el embebido no depende de la clasificación); con la de Javi: el Lexis completo intacto.

---

### Fase 5 — Vista admin de Javi (esfuerzo: M)

**Objetivo:** decisión 6 — Javi ve datos y conversaciones de ambos usuarios.

**Tareas:**
- Rutas server-only `/api/admin/*` gated por `requireAdmin()` (Fase 1) que usan `createServiceClient` (`src/lib/supabase/server.ts:38-50`) + página `/admin` con selector de usuario, visible solo en modo full. Opción recomendada por ambos auditores: cero cambios en las 20+ políticas RLS existentes. (M)
- Alternativa/refuerzo posterior: políticas SELECT adicionales `(auth.jwt()->'app_metadata'->>'role')='admin'` en tablas de lectura — defensa en BD sin service role. (opcional, M)

**Hecho cuando:** Javi ve las conversaciones de Silvestre desde `/admin`; la sesión de Silvestre recibe 403 en toda ruta `/api/admin/*`.

---

### Fase 6 — SOP mensual y convivencia con los GPTs (esfuerzo: S)

**Objetivo:** una sola verdad durante la convivencia GPTs+Lexis (decisión 8).

**Tareas:**
- Actualizar `silvestre-gpts\PROCEDIMIENTO-ACTUALIZACION.md` (hito del 4º jueves, §3): tras build.py del hub + `actualizar-todo.py`, añadir `python cargar_supabase.py` Y MANTENER la subida de los 5 Excel a los GPTs — ambos destinos en la misma sesión, o Silvestre recibirá cifras distintas según dónde pregunte. (S)
- Extraer los 5 prompts .docx de `silvestre-gpts\prompts\` a markdown versionado en el repo Lexis y fusionarlos en el system prompt del modo Silvestre, deduplicando contra los COMENTARIOS de build_datamart (sobrevive el aviso "último mes de Confindustria provisional", §5). (S)
- Opcional barato: parametrizar el año hardcodeado de `build_confindustria_2026.py:39-46` antes de enero 2027. (S)

**Hecho cuando:** un ciclo mensual completo ejecutado con GPTs y Lexis dando las mismas cifras; SOP y .ics actualizados.

---

### Fase 7 — GATE: validación con Silvestre en persona (PENDING de Javi)

**Objetivo:** Silvestre usa Lexis de verdad. Es la puerta que abre la Fase 8 y la retirada de GPTs.

Sesión presencial: entrega de contraseña · instalación de la PWA en su iPhone · **activación de notificaciones push y prueba de un recordatorio real** (decisión 10) · batería de preguntas reales (ventas país, cuota, precios, compras, proveedores) · verificación de tono/formato ejecutivo. Avisarle proactivamente de la divergencia deliberada Chile/Italia respecto a su Power BI (`build_sociedad.py:37-58`, fix autorizado 2026-08-11) antes de que la descubra él.

**Hecho cuando:** OK explícito de Silvestre (criterio de Javi).

---

### Fase 8 — Apagado completo de Clavis (ÚLTIMA FASE, solo tras Fase 7)

En este orden (auditor de infra):

1. Deshabilitar el workflow keep-warm (`.github/workflows/keep-warm.yml`, cron */14 contra clavis-59r0/health) ANTES de borrar Render.
2. Verificar en dash.cloudflare.com si existe el worker `clavis-cron` — según DOSSIER §6.6 NUNCA se desplegó; si existe, borrarlo. **REGLA DE ORO: solo tocar lo que empiece por `clavis-`** — el Worker de Acta es el latido de recordatorios de LEXIS (y con la decisión 10, también de la agenda de Silvestre) y sigue en producción.
3. Borrar el proyecto CF Pages "clavis" (clavis-3tq.pages.dev); eliminar el icono PWA del iPhone de Silvestre si llegó a instalarse.
4. Borrar el Web Service de Render identificándolo POR HOST `clavis-59r0.onrender.com` (clavis-api.onrender.com es de OTRO usuario — trampa 1); solo tras verificar el export de Fase 0.
5. Supabase `fabuvregksslptafjbko`: PAUSAR (reversible, libera hueco del tope de 2 activos); BORRAR definitivamente solo con la Fase 7 superada. Registrar en la memoria workspace-supabase-free-tier-org-cap.
6. R2: borrar el objeto clavis-datos.duckdb (PII de 1.428 clientes y 3.866 proveedores), el bucket clavis-datos, y TODOS los tokens llamados "clavis-api" (pueden existir duplicados zombis).
7. Revocar claves externas consultando ANTES el inventario `00-sistema-metodo\cuentas\`: RESEND_API_KEY (sandbox, sin DNS que limpiar) y OR_KEY de OpenRouter (posiblemente compartida).
8. Commit lápida (borrar keep-warm.yml + nota de apagado con puntero al paquete de export; `git commit -F` — trampa 17), push (lo hace Javi), y Archive del repo gpjcalero/clavis. AVISO: archivar NO preserva el informe personal ni el duckdb (gitignoreados) — el paquete de Fase 0 es su única salvaguarda.
9. Retirar los 5 GPTs de Silvestre y el paso de subida manual del SOP (el envío picopa→servidor solo si el PBI también se retira; hoy sigue vivo).
10. Checklist de humo: Pages y Render caídos, Supabase clavis pausado/ausente, cero restos clavis-* en Cloudflare, **Worker de Acta INTACTO**, Actions deshabilitadas, sin zombis en Railway; lápida en el DOSSIER de Clavis, memorias actualizadas, inventario de cuentas y mapas de portfolio al día.

---

## 3. Riesgos consolidados

| # | Riesgo | Mitigación |
|---|--------|------------|
| 1 | **Cambio de modelo de aislamiento del motor SQL** (el más citado): en Clavis el LLM-SQL solo tocaba un DuckDB aparte read-only; en Supabase convive con memorias/mensajes/usuarios de DOS personas. Si el SELECT corre con service role o `authenticated`, el validador textual es la única barrera. | Rol `clavis_datos_ro` + `default_transaction_read_only` + `search_path` + timeout (Fase 2). No opcional. Test: burlar el validador debe fallar por privilegios. |
| 2 | La suite "24/24 ataques" NO existe como código (solo la afirmación en GUIA-DATOS-R2:9; git log de 69 commits lo confirma). | Reconstruirla versionada (Fase 3) antes de dar el motor por seguro. |
| 3 | Dialecto DuckDB→Postgres en silencio: `round(double,2)` no existe, y la lista negra actual tiene términos DuckDB irrelevantes mientras faltan pg_sleep/pg_read_file/dblink/lo_import. | Tipos NUMERIC en el schema + lista negra adaptada + suite (Fases 2-3). |
| 4 | Pérdida de semántica = LLM que miente: sin los COMMENT ON (perímetros, hueco Ascer jul-2025, cortes por fuente) la cuota saldría infraestimada a la mitad (6,6% vs 13,6% real 2025, `build_datamart.py:252-263`). | Portar COMMENT ON en la migración; caso de cuota en la suite funcional. |
| 5 | `resultado_vacio` (SUM→1 fila NULL) y `_con_contexto` (seguimientos que pierden el filtro de país): los dos bugs peligrosos documentados de Clavis. | Port explícito de ambos (Fase 3) + tests dedicados. |
| 6 | Fuga entre usuarios en Lexis: signup abierto por magic link (`login/page.tsx:35`), bucket lexis-raw con paths planos sin user_id y `getPublicUrl`. Con el presidente dentro, es fuga bidireccional Javi↔Silvestre. (Las 6 RPC `p_user_id`: riesgo revisado a la baja, ver #21 — son SECURITY INVOKER.) | Fase 1 completa ANTES de cargar dato alguno de negocio. |
| 20 | **[CONFIRMADO 08-09] Enlaces `memory_projects`/`memory_entities` sin validar propietario del otro extremo → fuga de metadatos vía `/api/v1/search`+PAT Y, más grave, inyección de contenido ajeno en el resumen de IA de un proyecto/entidad vía el cron `refresh-summaries` (silencioso, sin acción del atacante tras el enlace inicial).** | Constraint/trigger de mismo propietario en ambos extremos + filtrar por `user_id` en `enrichMemories` y en los `refresh-summary.ts`; sanear enlaces existentes. BLOQUEANTE de Fase 1. |
| 21 | Riesgo de las 6 RPC `p_user_id` sin contraste: revisado a la baja tras auditoría externa — son `SECURITY INVOKER` (RLS sigue aplicando) y `entity_cooccurrence` ni siquiera toma ese parámetro. | Degradado a mejora opcional de bajo rango, no bloqueante. |
| 22 | Muestreo arbitrario en "últimas memorias" de `refresh-summary.ts` (orden por UUID / sin orden antes del LIMIT): el resumen de IA puede omitir actividad reciente real. | Ordenar por `captured_at desc` en SQL antes del LIMIT (Fase 4, antes de dar por bueno el chat de datos/memoria). |
| 7 | Estado real del Supabase de Lexis NO verificable desde el repo (signups, bucket, migraciones aplicadas post 16-07, incl. events_notified_at). | Auditoría del Dashboard en Fase 0; nada se da por seguro sin ella. |
| 8 | Admin solo con service role: un bug de gating en `/api/admin/*` expone datos cruzados; un flag admin en `user_settings` sería autoeditable. | Claim en `app_metadata` (solo service role lo escribe) + `requireAdmin` en toda ruta. |
| 9 | El "chat único" que espera Silvestre no existe: la síntesis actual solo lee `memories`, es mono-turno y la navegación oculta seguiría accesible por URL. | Router memorias/datos + chat persistente + guard de middleware (Fases 3-4); Fase 7 no se convoca sin esto en verde. |
| 10 | Excel `Ascer_nac_exp_y_Confindustria.xlsx` es ESTADO no reproducible (Confindustria 2023-2025 fosilizados). | El cargador sigue leyendo los Excel (nunca reconstruir desde sources); Supabase pasa a ser respaldo adicional. |
| 11 | Proxy corporativo puede bloquear Postgres directo (ya rompe fetch de Node y wss). | Test de conectividad en Fase 0 ANTES de diseñar el loader; fallback PostgREST con swap vía RPC. |
| 12 | Dos verdades durante la convivencia GPTs+Lexis si un mes se actualiza un destino y no el otro. | Acoplar ambos pasos al mismo hito del SOP (Fase 6). |
| 13 | Resend en sandbox: el digest de Silvestre (enabled=true por defecto) fallaría cada semana. | `enabled=false` al alta (Fase 1). |
| 14 | Importar los build_* ejecuta builds como efecto secundario (`build_sociedad.py` corre a nivel de módulo). | Copiar funciones de `build_datamart.py`, nunca importar build_*. |
| 15 | Apagado: pérdida irreversible del informe personal o de la BD de Clavis; confusión de servicios (clavis-api.onrender.com es de otro usuario; el Worker de Acta es de Lexis); OR_KEY posiblemente compartida; tokens R2 zombis; autoDeploy dispararía redeploys tras el push. | Fase 0 primero; Render por host; regla "solo clavis-*"; inventario de cuentas antes de revocar; servicios desconectados antes del commit lápida; pausar antes de borrar Supabase. |
| 16 | PII de negocio (1.428 clientes y 3.866 proveedores con nombre real) pasa de un fichero fuera de git a tablas Supabase. | RLS/allowlist ANTES del primer INSERT; revisar que api/v1, export y search no expongan el schema de datos. |
| 17 | Divergencia deliberada Chile/Italia respecto al PBI oficial de Silvestre. | Avisarle en la sesión de validación antes de que lo descubra. |
| 18 | Tope de 2 proyectos Supabase activos en la org gmail: Clavis debe seguir vivo durante la transición; reactivar un tercero pausaría uno sin avisar. | No tocar otros proyectos hasta pausar Clavis (Fase 8.5). |
| 19 | Service worker sirve el shell viejo tras el despliegue del home bifurcado. | Bump CACHE_VERSION; mantener el chat de Silvestre en '/'. |
| 20 | Notificaciones que nunca llegan (repetición del caso Javi julio-hoy): motor encendido pero 0 suscripciones push. | El criterio de "hecho" de Fase 4 exige una push REAL recibida; la de Silvestre se prueba en vivo en Fase 7. |

## 4. Decisiones que esta migración revierte (constancia)

1. **DuckDB→R2 fuera de Supabase → tablas Postgres en el Supabase de Lexis.** Decisión explícita de Javi 2026-09-07. Por qué ahora sí: al desaparecer la API de Render solo queda un runtime, y mantener R2+DuckDB obligaría a conservar la cadena boto3/sync y el pin duckdb 1.1.3 solo para un consumidor. La garantía de aislamiento no se abandona: se REDISEÑA como rol restringido + read-only + timeout, con suite de ataques que lo verifica.
2. **Clavis como app separada ("no clonar Lexis", 21-08) → Lexis unificado multiusuario.** Por qué ahora sí: (a) Silvestre NUNCA llegó a usar Clavis — no hay usuario ni datos que perder; (b) Lexis YA es estructuralmente multiusuario a nivel de datos — el coste real es de capa de producto, no de arquitectura; (c) el motivo original del descarte (multipantalla confunde) se resuelve con el modo simple + guard, no clonando; (d) apagar Clavis elimina 4 infraestructuras y libera el hueco Supabase.
3. **Colateral:** la cadena de actualización pasa a `hub → 5 Excel → cargar_supabase.py → Postgres`, manteniendo intactos los 7 build_* y sus Excel.

## 5. PENDING (depende de Javi o de terceros)

- Verificaciones del Dashboard de Supabase de Lexis (Fase 0): signups, bucket `lexis-raw`, migraciones aplicadas (incl. `events_notified_at`).
- Existencia real del worker `clavis-cron` en Cloudflare (el DOSSIER dice que nunca se desplegó; confirmar).
- Test de conectividad Postgres directa desde la red corporativa (proxy 172.22.1.121:8080).
- Alta y entrega de la contraseña de Silvestre (en modo simple no verá Ajustes: la contraseña debe existir de antemano).
- Validación en persona con Silvestre (Fase 7): gate del apagado, del borrado del Supabase de Clavis y de la retirada de los GPTs. Sin fecha.
- Inventario de cuentas (`00-sistema-metodo\cuentas\`): confirmar si OR_KEY y la cuenta Resend de Clavis se reutilizan antes de revocar.
- Push del commit lápida y archivado del repo gpjcalero/clavis.
- Eliminar el icono de la PWA de Clavis del iPhone de Silvestre, si llegó a instalarse.
- Decisión de retención del paquete de export (dump + duckdb + informe personal, todo con PII).
- Confindustria 2027: si la migración se alarga hasta enero, crear los ficheros "2027 valor en..." y tocar `build_confindustria_2026.py` (o parametrizarlo ya, Fase 6).
