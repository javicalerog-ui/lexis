# Plan de implementación — orden de construcción real

> Este documento traduce `PLAN-MIGRACION-CLAVIS-LEXIS.md` (el QUÉ, con decisiones/riesgos/tareas) en el CÓMO y EN QUÉ ORDEN se construye, priorizado para llegar cuanto antes al momento en que Silvestre usa la app de verdad. Las fases 5/6/8 de ese plan (admin, SOP, apagado de Clavis) se empujan deliberadamente después de la validación — no bloquean que Silvestre tenga algo funcional.

## Camino crítico

```
Build 0 (seguridad P1)  →  Build 1 (cuentas)  →  Build 2 (datos)  →  Build 3 (chat+motor)  →  Build 4 (validación Silvestre)
     yo solo                yo + tú en paralelo      yo solo             yo solo                    tú + Silvestre
                                                                                                            │
                                                                                                            ▼
                                                                          Build 5 (admin, SOP, home unificado Javi, apagar Clavis)
```

Build 2 y Build 3 son los bloques grandes (esfuerzo L cada uno en el plan de migración) — varias sesiones de trabajo cada uno, no algo de una tarde. El resto son piezas de tamaño S/M que se resuelven en una sesión o menos.

---

## Build 0 — Cerrar el hallazgo P1 de seguridad ✅ COMPLETADO 2026-09-08

> Código en verde (typecheck limpio) + migración `20260908000000_fix_memory_link_ownership.sql` aplicada y verificada en producción (2 triggers × 2 eventos = 4 filas en information_schema.triggers). También incluyó el fix P2 (orden por captured_at en SQL). Detalle debajo.


**Por qué va primero:** es la única pieza que bloquea con seguridad TODO lo que viene después (Build 2 carga datos de negocio; Build 3 activa el PAT/API v1 para dos usuarios) y ya está completamente verificada. Arreglarla ahora significa que Build 2 y 3 nacen ya seguros, en vez de tener que volver atrás.

**Qué se hace (yo, código + migración):**
1. Auditar en la BD real si ya existen enlaces `memory_projects`/`memory_entities` cruzados entre usuarios (hoy solo hay un usuario, así que lo esperable es que no haya ninguno — pero se verifica, no se asume).
2. Migración: constraint/trigger que exija mismo `user_id` en ambos extremos de `memory_projects` y `memory_entities` antes de insertar.
3. Código: `src/lib/search/filters.ts` (`enrichMemories`) recibe y filtra por `userId`; `src/lib/projects/refresh-summary.ts` y `src/lib/entities/refresh-summary.ts` filtran las memorias enlazadas por propietario.
4. De paso (mismo área de código, coste marginal): fix del P2 — ordenar por `captured_at desc` en SQL antes del `LIMIT`, no después en memoria.

**Verificación:** un intento deliberado de enlazar una memoria propia a un proyecto ajeno falla en la BD; los tests existentes de `refresh-summary` (si los hay) siguen en verde.

**Bloqueado por:** nada. Empiezo ahora mismo.

---

## Build 1 — Cuentas y cierre de seguridad de acceso (Fase 1 del plan de migración)

**Mezcla código mío + acciones tuyas en el Dashboard de Supabase — pueden ir en paralelo.**

### ✅ Estado Build 1 (2026-09-08)
- Rol admin de Javi (`gpjcalero@gmail.com`): APLICADO y verificado (`app_metadata.role=admin`). OJO: existen 2 cuentas de Javi en auth.users (`gpjcalero@gmail.com` = la que usa para entrar, ya admin; `javicalerog@gmail.com` = segunda cuenta suya, sin rol). Revisar si conviene consolidar/limpiar la segunda más adelante.
- `shouldCreateUser:false` en login: hecho en código (typecheck verde).
- Rol admin en código: helper `src/lib/auth/admin.ts` listo.

### ✅ Comprobaciones completadas 2026-09-08
- **Registro de usuarios: CERRADO** (Javi apagó "Allow new users to sign up"; anonymous ya estaba off). Falta aún `shouldCreateUser:false` en código como refuerzo.
- **Migración de agenda de recordatorios: YA APLICADA** (`events.notified_at` existe). El motor de recordatorios está listo en BD; solo falta activar push en los iPhone (0 suscripciones hoy).
- **Tablas acta_* y triggers P1: presentes y correctos.**
- **Bucket `lexis-raw`: NO EXISTE.** Solo lo usan foto-de-calendario e importación de ficheros (no la captura de voz→texto ni nada del camino de Silvestre). Riesgo de bucket público = MOOT. Esas 2 funciones están rotas hoy; se arreglan creando el bucket privado+por-usuario cuando se quieran (sub-tarea diferida, no bloquea).
- **Conectividad: Postgres directo NO (DNS falla desde red corp); PostgREST/HTTPS vía proxy SÍ (401).** → cargador por HTTPS (ver Build 2 paso 3).
- Contraseña mínima está en 6 sin complejidad: subirla al crear la cuenta de Silvestre.


| Tarea | Quién | Bloqueada por |
|---|---|---|
| Comprobar toggle "Allow new users to sign up" en Supabase | Tú (guía paso a paso) | Nada — puedes hacerlo ya |
| Comprobar si el bucket `lexis-raw` es público | Tú (guía paso a paso) | Nada — puedes hacerlo ya |
| Comprobar qué migraciones están realmente aplicadas (incl. `events_notified_at` de la agenda) | Tú (guía paso a paso) | Nada — puedes hacerlo ya |
| Test de conectividad Postgres directa vs PostgREST desde tu red | Tú (te doy el comando) | Nada — puedes hacerlo ya, y condiciona el diseño de Build 2 |
| `shouldCreateUser:false` en el login + cerrar signup en Dashboard | Yo (código) + tú (Dashboard) | Nada |
| Rol admin de Javi vía `app_metadata` + helper `requireAdmin()` | Yo (código, script one-shot) | Nada |
| Flag `ui_mode='simple'` para Silvestre | Yo (código) | Alta de la cuenta de Silvestre |
| Alta de Silvestre (contraseña + Auto Confirm) | Tú, en el Dashboard, idealmente con él delante | Nada técnico — es una decisión de cuándo |
| `digest_preferences.enabled=false` para Silvestre | Yo (código, en el mismo script de alta) | Alta de Silvestre |
| Aislar bucket `lexis-raw` (paths por user_id, signed URLs) | Yo (código + migración) | Resultado de la comprobación "es público" |

**Te lanzo la guía paso a paso de las 4 comprobaciones + el test de conectividad en cuanto confirmes que quieres arrancar** — son 15-20 minutos tuyos y desbloquean el diseño final de Build 2.

---

## Build 2 — Motor de datos: schema Postgres + cargador (Fase 2)

**El bloque más grande, prácticamente todo yo.** Se puede empezar a diseñar el schema YA (no depende de nada tuyo), pero el cargador definitivo (transaccional vs por lotes HTTP) depende del test de conectividad de Build 1.

Orden interno:
1. ✅ **HECHO 2026-09-08** — Migración del schema `datos` (`20260908000100_datos_schema.sql`): 8 tablas + vista `ventas_pais` + los `COMMENT ON` literales traducidos 1:1 de `build_datamart.py` (incluida la advertencia de cuota 6,6% vs 13,6% y el hueco Ascer jul-2025) + índices + blindaje de grants (schema NO expuesto, sin acceso anon/authenticated).
2. ✅ **HECHO 2026-09-08** — Rol restringido + envoltura de ejecución (`20260908000200_datos_ro_role.sql`): rol `datos_ro` sin privilegios sobre public/auth + función `public.datos_run_query()` SECURITY DEFINER que ejecuta el SELECT como ese rol, con tope 200 filas, timeout 4s y transacción read-only. Es la barrera dura del riesgo #1. Incluye prueba de humo comentada.
3. ⏳ `cargar_supabase.py` — **DECIDIDO 2026-09-08 por test de conectividad:** Postgres directo NO alcanzable desde la red corporativa (DNS de `db.<ref>.supabase.co` falla); REST/HTTPS vía proxy SÍ (401 = alcanzable). Por tanto el cargador va por **PostgREST/HTTPS a través del proxy** → tablas de staging por lotes → RPC `datos.swap_staging()` (SECURITY DEFINER, service_role) que hace el TRUNCATE+INSERT atómico en el servidor (no hay transacción multi-request sobre PostgREST). Funciona desde el portátil corporativo de Javi tal cual. Ya se puede construir.
4. ⏳ Carga real + validación de paridad contra el DuckDB congelado (Francia 2025 = 56.953.780,72; precios ~23/16/10 €/m²).

**Estado:** pasos 1-2 escritos y listos para aplicar (guided-apply pendiente — se puede aplicar ya para probar el aislamiento, o bundlear con el loader). Pasos 3-4 esperan el test de conectividad.

> ⚠️ Regla de código para Build 3 (anotada en la migración del rol): el servidor debe ejecutar el SQL del LLM SIEMPRE vía la función de aislamiento, nunca con el cliente service_role directo sobre el schema `datos` — eso saltaría el aislamiento.

> ⚠️ **TROPIEZO 2026-09-08 (resuelto en diseño):** la migración `..._000200` fallaba con `42501: permission denied for schema public`. Diagnóstico: postgres SÍ puede crear en public (`has_schema_privilege`=true); el fallo era `alter function ... owner to datos_ro` — Postgres exige que el NUEVO propietario (datos_ro) tenga CREATE en el schema de la función, y datos_ro solo tiene lectura. La migración se ELIMINÓ (rollback completo, nada quedó en BD; `existe_datos_ro`=false confirmado). **REDISEÑO adoptado para Build 3:** el aislamiento del motor de consultas se hará con un **rol de conexión LOGIN de solo lectura** (`datos_ro` con USAGE+SELECT solo sobre `datos`, statement_timeout, search_path=datos) al que Vercel se conecta por pooler para ejecutar el SQL del LLM. Viable porque Build 3 corre en Vercel, no en la red corporativa (el bloqueo de Postgres directo era solo desde el portátil de Javi). Sin función SECURITY DEFINER, sin tocar public, sin transferencia de propietario. Se construye junto al código que lo llama, con prueba E2E. El cargador (Build 2) NO lo necesita.

---

## Build 3 — Capa de consulta + chat del modo Silvestre (Fases 3 + 4 del plan)

**Todo yo.** El validador SQL y el pipeline pregunta→SQL→respuesta se pueden escribir y testear contra el schema de Build 2 en cuanto exista, con datos de prueba si hace falta ir en paralelo.

Incluye lo ya decidido en las tandas anteriores: captura-todo por defecto (decisión 9), confirmación obligatoria de recordatorios (decisión 10), chat único sin pestañas para Silvestre (decisión 11), guard de middleware, bump de caché del Service Worker.

**Bloqueado por:** Build 2 completo para las pruebas funcionales reales (las 5 "preguntas de fuego"); el código en sí se puede escribir antes.

---

## Build 4 — GATE: validación con Silvestre en persona (Fase 7)

No es código. Es una sesión contigo y con él: entrega de contraseña, instalar la PWA, activar notificaciones, probar un recordatorio real, batería de preguntas de negocio reales. Sin fecha — la fijas tú cuando Build 1-3 estén verdes.

---

## Build 5 — Después de validar (menor prioridad, no bloquea el uso real)

Por este orden de valor, pero todo puede esperar a que Silvestre ya esté usando la app:
1. Vista admin de Javi (Fase 5) — cómoda, no crítica para que Silvestre trabaje.
2. Home unificado también para ti (decisión 11, segunda mitad) — mejora de tu propia experiencia.
3. SOP mensual + extracción de prompts de los GPTs (Fase 6).
4. Apagado completo de Clavis (Fase 8) — solo tras el Build 4.

---

## UX aplicada 2026-09-08 (local, sin desplegar)
- **Menú lateral legible:** nuevo `src/components/nav/NavDrawer.tsx` (botón ☰ → drawer con icono + NOMBRE, agrupado, responsive; cierra con fuera/X/Escape/enlace). Sustituye la fila de iconos crípticos de `src/app/page.tsx` (headerRight). Quitados del menú por decisión de Javi (rutas siguen existiendo): Reuniones/Acta, Entrevista, Conectores, Exportar grafo, Tokens API. Conservados: Inicio, Importar, Cronología, Proyectos, Entidades, Feed, Bandeja, Panel, Resumen periódico (Digest), Contraseña, Cerrar sesión.
- **Abre en "Buscar":** `page.tsx` arranca con `mode='search'` en vez de 'capture'.
- Typecheck verde. NO verificable en navegador desde aquí (la home está tras login + hay otro dev server ocupando la carpeta); se verá al desplegar en el móvil de Javi.
- PENDIENTE: desplegar (push desde terminal de Javi → Vercel javicalerog-ui/lexis). Limpiar 1-2 memorias basura creadas al importar por error los Excel de datos (SQL de una línea, cuando se quiera).

## Auditoría externa (otro LLM) 2026-09-08 — triage
Informe completo en `docs/AUDITORIA-PROFUNDIDAD-2026-09-08.md`. Cruzado:
- YA arreglado y desplegado (5449c5f): fuga cross-user P1, resúmenes P2, shouldCreateUser, rol admin.
- Arreglado local (pendiente deploy): **[ALTO] Markdown ejecutaba JS (gray-matter engine)** → `markdown.ts` fuerza YAML + desactiva motores js/coffee; **[MEDIO] PDF worker version mismatch** → `pdf.ts` usa `mod.version` vía jsdelivr (pdfjs 4.10.38).
- Confirmado a la baja (coincide con nuestra corrección): RPC p_user_id son SECURITY INVOKER, no fuga directa.
- ANTES de Silvestre: [ALTO] SW cachea HTML autenticado tras logout (fuga multiusuario); [ALTO] push marca notified aunque falle + [MEDIO] snooze/reopen no resetea notified_at (agenda).
- DIFERIDO hasta activar conectores (no están on): SSRF RSS, filtro Gmail que deriva, cursores que pierden items, Drive/Calendar ignoran updates/cancelaciones, cron connectors reporta 0 fallos, reauth Google identidad. CANDADO: no encender conectores sin arreglarlos.
- Deuda: validar JSON del LLM con Zod (raíz de "LLM no devolvió JSON parseable"), tests de 2 usuarios/cursores/push. Varios MEDIO menores (digest atómico, timeline paginación, export paginación, DST, all-day, deadlines IA, transcribe 4.5MB Vercel, cuotas IA, acta audio cross-account).
- Nota: SOP control = DRIFT (sync-portfolio-sop pendiente).

## Mejoras detectadas en uso (2026-09-08)
- **Captura/import se rompe con Excel de datos grandes:** al soltar `Ascer_nac_exp_y_Confindustria.xlsx` (643 KB) en la pantalla Capturar, el pipeline devuelve `FetchJsonError: LLM no devolvió JSON parseable ni en Fast ni en Deep` (el clasificador manda el contenido tabular enorme al LLM y este no devuelve JSON válido / excede tokens). Doble problema: (a) esos Excel son fuente del motor `datos`, no memorias; (b) el pipeline debería degradar con un mensaje claro ("parece un fichero de datos, va al motor, no a memorias") en vez de un error técnico. Mejora: detectar xlsx muy grandes/tabulares y avisar; y hacer el parseo de JSON del clasificador tolerante a fallo. No urgente.

## Qué puedes hacer tú YA, en paralelo, sin esperarme

Estas 5 cosas no dependen de ningún código mío y desbloquean Build 1/2 antes:
1. Comprobar el toggle de signup en Supabase Dashboard.
2. Comprobar si `lexis-raw` es público.
3. Comprobar qué migraciones están aplicadas.
4. Correr el test de conectividad Postgres/PostgREST.
5. Decidir cuándo quieres hacer el alta de Silvestre (idealmente con él delante, aprovechando para instalar la PWA de una vez).

Dime cuándo quieres la guía paso a paso de las 4 primeras y te la preparo ahora mismo — mientras tanto, yo arranco ya con el Build 0.
