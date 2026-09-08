# Auditoría de seguridad, corrección y robustez — Lexis

**Fecha:** 2026-09-08  
**Alcance:** revisión estática y de solo lectura del repositorio. No se ejecutaron la aplicación, build, pruebas ni pruebas de explotación.  
**Contexto:** la evaluación trata Lexis como una aplicación multiusuario con datos personales y de negocio que no deben cruzarse.

## Límites de certeza

Este informe confirma lo que está presente en el árbol de código y las migraciones. No permite certificar la configuración remota de Supabase o Vercel: migraciones aplicadas, bucket público, signups habilitados, claves, VAPID, Resend y políticas efectivamente desplegadas requieren comprobación en producción.

## Hallazgos

### [ALTO] Importar Markdown puede ejecutar JavaScript dentro de la sesión

**Categoría:** seguridad  
**Fichero:línea:** `src/lib/ingestion/markdown.ts:17`  
**Qué pasa:** `matter(text)` permite al archivo seleccionar el motor de frontmatter. La dependencia instalada `gray-matter@4.0.3` incluye el motor `javascript`, que ejecuta el contenido con `eval` en `node_modules/gray-matter/lib/engines.js:36-43`. El parsing se realiza en el navegador autenticado.

**Escenario de fallo:** importar un Markdown de un tercero con encabezado `---javascript` ejecuta JavaScript en el origen de Lexis y puede realizar solicitudes autenticadas con resultados legibles para el atacante.

**Fix propuesto:** restringir el parser a YAML/JSON seguros y rechazar motores ejecutables. Añadir una prueba con un Markdown que declare `javascript`.

### [ALTO] Relaciones entre usuarios permiten filtrar metadatos mediante service role

**Categoría:** seguridad  
**Fichero:línea:** `supabase_migrations/20260522000000_initial_schema.sql:193`, `src/lib/search/filters.ts:84`  
**Qué pasa:** las políticas de `memory_projects` y `memory_entities` verifican la propiedad de la memoria, pero no la del proyecto o entidad enlazados. Las claves foráneas simples tampoco fuerzan el mismo propietario. `/api/v1/search` usa service role y `enrichMemories` expande relaciones por `memory_id` sin filtrar dueño.

**Escenario de fallo:** A conoce el UUID de un proyecto o entidad de B, enlaza ese UUID a una memoria propia y consulta con un PAT propio. La respuesta devuelve nombre/slug/tipo de B. La misma integridad ausente permite contaminar resúmenes procesados por cron con memorias de otro usuario. No se demostró enumeración de UUID ni lectura completa de memorias de B.

**Fix propuesto:** comprobar ambos extremos en RLS, incorporar `user_id` y FKs compuestas para las relaciones, filtrar relaciones expandidas por propietario y sanear enlaces cruzados existentes. Aplicar el mismo principio a `events.linked_project_id` y `linked_entity_id`.

### [ALTO] La caché offline conserva HTML privado después del logout

**Categoría:** seguridad  
**Fichero:línea:** `public/sw.js:103`, `src/app/page.tsx:221`  
**Qué pasa:** el service worker guarda respuestas HTML de navegación en una caché compartida por origen. Logout no la invalida. Algunas páginas son renderizadas con datos privados, incluidos mensajes de entrevistas.

**Escenario de fallo:** A abre una entrevista, cierra sesión y B usa el mismo navegador sin conexión. La navegación a la URL cacheada puede devolver HTML de A sin comprobar autenticación.

**Fix propuesto:** no cachear HTML autenticado; usar una pantalla offline neutra. Limpiar cachés privadas en cambio de sesión y al desplegar la corrección.

### [ALTO] El conector RSS permite SSRF

**Categoría:** seguridad  
**Fichero:línea:** `src/lib/connectors/adapters/rss.ts:114-145`  
**Qué pasa:** validar con `new URL()` admite destinos internos, protocolos no esperados y redirecciones. El servidor hace `fetch` sin filtrar IPs privadas, sin timeout ni límite de bytes.

**Escenario de fallo:** un usuario configura un feed con loopback, red privada o un host que redirige a ella; Lexis realiza la petición desde su infraestructura. El acceso efectivo depende de la red de producción y no se ha demostrado acceso a metadata ni secretos.

**Fix propuesto:** aceptar sólo HTTP(S), resolver y validar IP pública antes de conectar y en cada redirección, bloquear rangos privados/link-local, impedir rebinding y limitar tiempo y tamaño.

### [ALTO] Gmail deja de respetar el filtro configurado tras el primer sync

**Categoría:** seguridad  
**Fichero:línea:** `src/lib/connectors/adapters/gmail.ts:269-326`  
**Qué pasa:** la rama inicial aplica `query`, pero History API recopila todos los `messageAdded` sin cruzarlos con la consulta configurada.

**Escenario de fallo:** con `label:lexis-inbox`, la primera ejecución captura sólo correos seleccionados. Las siguientes capturan también correo personal o confidencial no etiquetado y lo envían a los proveedores de IA.

**Fix propuesto:** intersectar los IDs de History API con una búsqueda que aplique exactamente la consulta configurada y definir explícitamente el comportamiento al modificar etiquetas.

### [ALTO] Los conectores avanzan cursores después de perder elementos

**Categoría:** bug de correctness  
**Fichero:línea:** `src/lib/connectors/runner.ts:166-180`, `src/lib/connectors/adapters/rss.ts:180-190`  
**Qué pasa:** tras un error de ingestión individual se actualiza incondicionalmente `result.new_state`. RSS incluye los elementos emitidos dentro de `seen_ids`; Drive y Calendar también avanzan tokens.

**Escenario de fallo:** falla temporalmente Voyage o la BD para una noticia. No se crea la memoria, pero queda marcada como vista y no vuelve a intentarse.

**Fix propuesto:** persistir una cola durable de pendientes o confirmar el cursor únicamente tras procesar todos los elementos. Tratar el fallo del adaptador como estado operacional visible.

### [ALTO] Los límites de Drive y Calendar descartan cambios aunque no haya errores

**Categoría:** bug de correctness  
**Fichero:línea:** `src/lib/connectors/adapters/calendar.ts:301-321`, `src/lib/connectors/adapters/drive.ts:519-537`  
**Qué pasa:** ambos adaptadores limitan elementos después de obtener páginas, pero pueden persistir el token que indica que todas ellas han sido consumidas.

**Escenario de fallo:** Calendar devuelve 150 eventos: procesa 100 y puede guardar el token final, olvidando los otros 50. Drive presenta la misma pérdida si los cambios superan `maxPerRun`.

**Fix propuesto:** guardar página, posición y elementos pendientes; avanzar el token final sólo tras procesar todas las páginas.

### [ALTO] Drive y Calendar ignoran actualizaciones y cancelaciones

**Categoría:** bug de correctness  
**Fichero:línea:** `src/lib/connectors/runner.ts:124-136`, `src/lib/connectors/adapters/drive.ts:299`, `src/lib/connectors/adapters/calendar.ts:154`  
**Qué pasa:** la deduplicación salta cualquier `external_id` ya existente. Ambos adaptadores usan IDs estables del recurso, por lo que una modificación nunca llega al pipeline ni al upsert de Calendar.

**Escenario de fallo:** una reunión cambia de hora o se cancela; Lexis retiene la hora anterior. Un documento de Drive editado mantiene la memoria anterior.

**Fix propuesto:** separar identidad y versión; procesar modificaciones y cancelaciones antes de deduplicar memorias.

### [ALTO] Un push fallido marca el recordatorio como notificado

**Categoría:** bug de correctness  
**Fichero:línea:** `src/app/api/cron/reminders/route.ts:83-85`, `src/lib/push/send.ts:138-159`  
**Qué pasa:** `sendPush` absorbe errores y devuelve contadores. El cron actualiza `notified_at` si no hay excepción, aunque `sent=0` y `failed>0`.

**Escenario de fallo:** un fallo temporal del proveedor deja al usuario sin aviso y elimina cualquier reintento futuro.

**Fix propuesto:** diferenciar entrega aceptada, ausencia deliberada de suscripciones y fallo recuperable. Reintentar el último y comprobar los errores de persistencia.

### [MEDIO] Posponer o reabrir un evento no habilita otra notificación

**Categoría:** bug de correctness  
**Fichero:línea:** `src/app/api/events/[id]/route.ts:70-100`  
**Qué pasa:** `snooze`, `reopen` y editar `due_at` conservan `notified_at`. El cron sólo selecciona eventos con ese campo nulo.

**Escenario de fallo:** el usuario pospone un recordatorio recibido dos días y éste no vuelve a sonar.

**Fix propuesto:** resetear el estado de notificación al reprogramar, también en `src/app/api/agent-actions/[id]/respond/route.ts`.

### [MEDIO] PDF.js usa un worker de versión incompatible

**Categoría:** bug de correctness  
**Fichero:línea:** `src/lib/ingestion/pdf.ts:17-18`, `package-lock.json:5493`  
**Qué pasa:** el lockfile instala `pdfjs-dist@4.10.38` y el worker CDN está fijado a `4.7.76`; PDF.js verifica que ambas versiones coincidan.

**Escenario de fallo:** la importación PDF falla al inicializar el worker.

**Fix propuesto:** servir el worker de la misma versión instalada, sin mantener la versión manualmente.

### [MEDIO] Una imagen invalida un lote entero de importación

**Categoría:** bug de correctness  
**Fichero:línea:** `src/app/import/page.tsx:125-129`, `src/app/api/import/route.ts:23-34`  
**Qué pasa:** el cliente inserta una imagen con `raw_text: ''`; la API exige al menos un carácter. La ruta masiva tampoco ejecuta el caption de imagen.

**Escenario de fallo:** un lote que incluye una imagen es rechazado antes de procesar los textos. La imagen subida queda huérfana.

**Fix propuesto:** definir un esquema discriminado por tipo y reutilizar el caption de `/api/capture`.

### [MEDIO] SheetJS instalado tiene vulnerabilidades en la ruta de lectura

**Categoría:** seguridad  
**Fichero:línea:** `src/lib/ingestion/xlsx.ts:20-22`, `package-lock.json:7186`  
**Qué pasa:** `xlsx@0.18.5` procesa archivos proporcionados por el usuario. SheetJS declara afectadas las versiones hasta 0.19.2 por contaminación de prototipos y hasta 0.20.1 por ReDoS.

**Escenario de fallo:** una hoja preparada puede bloquear el hilo del navegador o alterar prototipos durante el parseo. El alcance confirmado es cliente, no RCE de servidor.

**Fix propuesto:** actualizar a distribución oficial corregida (al menos 0.20.2), ejecutar parsing en worker y acotar recursos.

### [MEDIO] Audio pendiente se comparte entre cuentas del mismo navegador

**Categoría:** seguridad  
**Fichero:línea:** `src/app/meetings/page.tsx:29-33`, `src/lib/acta/idb.ts:67-70`  
**Qué pasa:** IndexedDB guarda un único metadato `active`; incluye `userId`, pero la pantalla no lo compara con la sesión antes de mostrarlo, reanudarlo o borrarlo.

**Escenario de fallo:** A deja audio pendiente, B inicia sesión en el mismo dispositivo y ve su título o puede descartar sus fragmentos.

**Fix propuesto:** separar registros por usuario y validar propiedad antes de cualquier operación.

### [MEDIO] Digest sin reserva atómica ni idempotencia de envío

**Categoría:** bug de correctness  
**Fichero:línea:** `src/app/api/cron/digest/route.ts:112-171`, `src/lib/digest/email.ts:39-58`  
**Qué pasa:** la decisión de envío se lee antes de reservar la entrega. Dos ejecuciones pueden ser elegibles simultáneamente; no se usa clave de idempotencia y no se comprueban algunos updates posteriores al envío.

**Escenario de fallo:** dos crons envían el mismo digest o un envío correcto no actualiza `last_sent_at`, provocando repetición.

**Fix propuesto:** reservar una entrega única por usuario/período en una operación atómica y reutilizarla para reintentos.

### [MEDIO] El cron de conectores informa cero fallos cuando el runner falló

**Categoría:** bug de correctness  
**Fichero:línea:** `src/app/api/cron/connectors/route.ts:57-79`, `src/lib/connectors/runner.ts:230-238`  
**Qué pasa:** el runner devuelve `status: 'failed'` sin lanzar; el cron cuenta sólo `r.error`.

**Escenario de fallo:** fallo OAuth o proveedor caído devuelve HTTP 200 y `failed:0` al monitor.

**Fix propuesto:** calcular el resumen desde `run.status` e informar parciales y fallos operacionalmente.

### [MEDIO] Timeline puede repetir resultados y no avanzar

**Categoría:** bug de correctness  
**Fichero:línea:** `src/app/api/timeline/route.ts:38-50`, `supabase_migrations/20260522000006_sprint8_search_metrics.sql:52`  
**Qué pasa:** el cursor contiene sólo `captured_at` y la consulta usa un límite inclusivo (`<=`).

**Escenario de fallo:** la segunda página incluye el último resultado de la anterior. Con fechas idénticas puede repetirse indefinidamente.

**Fix propuesto:** usar cursor compuesto `(captured_at,id)`, orden estable y comparación estricta.

### [MEDIO] Los resúmenes pueden omitir decisiones recientes

**Categoría:** bug de correctness  
**Fichero:línea:** `src/lib/projects/refresh-summary.ts:69-80`, `src/lib/entities/refresh-summary.ts:48-63`  
**Qué pasa:** se limita una relación ordenada por UUID y se ordena por fecha después; no se seleccionan las últimas memorias reales.

**Escenario de fallo:** con más de 40 memorias, una decisión nueva puede quedar fuera y el resumen muestra un estado viejo.

**Fix propuesto:** filtrar memorias activas y ordenar por `captured_at` en SQL antes del límite. Aplicar a entidades y próximos pasos.

### [MEDIO] Export puede omitir relaciones y mensajes sin indicarlo

**Categoría:** bug de correctness  
**Fichero:línea:** `src/lib/export/build.ts:111-128`, `src/lib/export/build.ts:166-178`  
**Qué pasa:** tablas principales se paginan, pero relaciones y mensajes se consultan por lotes de IDs sin paginar resultados y se ignoran errores.

**Escenario de fallo:** un resultado supera el límite de PostgREST o falla una relación; el export se entrega incompleto sin aviso.

**Fix propuesto:** paginar todas las colecciones, comprobar errores y validar recuentos.

### [MEDIO] Reautorizar Google puede sustituir los tokens por otra cuenta

**Categoría:** seguridad  
**Fichero:línea:** `src/app/api/oauth/google/callback/route.ts:111-147`  
**Qué pasa:** al reutilizar una credencial se verifica su propietario Lexis, pero no se compara la identidad Google seleccionada con la identidad existente.

**Escenario de fallo:** el usuario elige otra cuenta Google al reautorizar; los conectores pasan a leerla bajo la etiqueta anterior.

**Fix propuesto:** exigir igualdad de identidad Google o crear una credencial distinta y pedir reasignación explícita.

### [MEDIO] Conversión de hora local incorrecta en cambio de horario

**Categoría:** bug de correctness  
**Fichero:línea:** `src/lib/time/userTime.ts:235-243`  
**Qué pasa:** `localToUtc` calcula el offset para una interpretación inicial y no lo revalida en el instante final.

**Escenario de fallo:** `2026-03-29T01:30:00` en Madrid puede convertirse una hora antes de lo esperado.

**Fix propuesto:** resolver validando que el UTC final vuelve a producir la hora local solicitada y definir horas ambiguas/inexistentes.

### [MEDIO] Eventos de día completo tienen inicio y fin iguales en Calendar

**Categoría:** bug de correctness  
**Fichero:línea:** `src/app/api/events/route.ts:90-92`  
**Qué pasa:** Calendar usa final exclusivo para eventos de día completo, pero se envía el mismo día en `start.date` y `end.date`.

**Escenario de fallo:** la creación externa recibe un intervalo vacío y puede fallar.

**Fix propuesto:** usar el día siguiente como final exclusivo.

### [MEDIO] Reintentos de IA superan el plazo de varias rutas

**Categoría:** bug de correctness  
**Fichero:línea:** `src/lib/llm/openrouter.ts:49-81`  
**Qué pasa:** permite tres intentos de hasta 45 segundos más esperas; varias rutas tienen máximos de 60 o 90 segundos y `Retry-After` no tiene tope.

**Escenario de fallo:** la petición expira antes de completar la política de reintentos, potencialmente después de trabajo persistido parcialmente.

**Fix propuesto:** asignar un plazo total por petición y no iniciar intentos que no caben.

### [MEDIO] Transcripción acepta tamaños por encima del límite efectivo de Vercel

**Categoría:** bug de correctness  
**Fichero:línea:** `src/app/api/audio/transcribe/route.ts:18`  
**Qué pasa:** la ruta acepta hasta 25 MB, mientras Vercel limita el cuerpo de Functions a 4,5 MB.

**Escenario de fallo:** un audio de 6 MB pasa la validación de producto pero Vercel responde 413 antes de llegar al handler.

**Fix propuesto:** carga directa a Storage privado o fragmentación, y reflejar el límite real en cliente.

### [MEDIO] Endpoints de IA sin cuota o límite de concurrencia por usuario

**Categoría:** seguridad  
**Fichero:línea:** `src/app/api/answer/route.ts:43-47`, `src/app/api/audio/tts/route.ts:39-49`  
**Qué pasa:** hay autenticación y límites de tamaño, pero no límites persistentes por usuario/PAT ni presupuesto diario para proveedores de pago.

**Escenario de fallo:** sesión comprometida o integración defectuosa consume coste y capacidad compartida.

**Fix propuesto:** cuota por usuario y operación antes de proveedores, presupuesto diario y concurrencia máxima.

### [MEJORA] La salida JSON de LLM se parsea sin validación de estructura

**Categoría:** deuda técnica  
**Fichero:línea:** `src/lib/llm/escalation.ts:58-75`, `src/lib/ingestion/pipeline.ts:50-58`  
**Qué pasa:** los tipos genéricos de TypeScript no validan la respuesta del proveedor.

**Escenario de fallo:** JSON sintácticamente válido con `projects` no-array provoca un fallo posterior tras parte de la ingestión.

**Fix propuesto:** usar esquemas Zod por operación antes de cualquier escritura y escalar ante incumplimiento.

### [MEJORA] La suite no cubre los riesgos principales

**Categoría:** deuda técnica  
**Fichero:línea:** `tests/run.mjs:1`  
**Qué pasa:** hay pruebas de cifrado, credenciales y contrato cron, pero no de aislamiento de dos usuarios, cursores, recordatorios, imports ni caché entre sesiones.

**Escenario de fallo:** la suite pasa aunque persistan las fugas y pérdidas anteriores.

**Fix propuesto:** incorporar pruebas de integración con dos usuarios, reintentos de conectores, paginación, cambio de sesión offline y entrega/reprogramación push.

## Riesgos previos verificados

| Riesgo | Estado actual |
|---|---|
| Magic link y autorregistro | Falta `shouldCreateUser:false` en `src/app/auth/login/page.tsx:35`. La configuración real de signups queda pendiente de Dashboard. Ya previsto en el plan. |
| `lexis-raw` | Persisten paths planos y `getPublicUrl` en `FloatingVoiceCapture`. Las migraciones no declaran sus políticas; no se puede inferir si producción es pública. Ya previsto en el plan. |
| RPC con `p_user_id` | Son `SECURITY INVOKER`; un parámetro ajeno no elimina RLS. No hay fuga directa demostrada sólo por ese argumento. |
| Rol admin | No está implementado. Es requisito explícito del plan de migración. |
| RAG mono-turno | Sigue siendo efímero. Está previsto en Fase 4. |
| Digest para altas | El default permanece habilitado. El plan ya exige deshabilitarlo para Silvestre. |
| Cifrado OAuth | Corregido en código: AES-256-GCM, AAD por fila/campo, rechazo de texto plano y rotación. Falta verificar datos y migración de producción. |
| Bundle SQL | Las primeras 16 migraciones coinciden; faltan tres posteriores, ya documentadas en el plan. |

## Dependencias

`xlsx@0.18.5` está afectada por avisos de SheetJS: [prototype pollution](https://cdn.sheetjs.com/advisories/CVE-2023-30533) y [ReDoS](https://cdn.sheetjs.com/advisories/CVE-2024-22363).

El lockfile fija Next.js `14.2.35`. Hay avisos posteriores que la incluyen, entre ellos [CVE-2026-23864](https://github.com/vercel/next.js/security/advisories/GHSA-h25m-26qc-wcjf) y el [aviso de AVIF](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4). No se ha demostrado explotación en este despliegue: requiere comprobar rutas afectadas y mitigaciones de Vercel.

## Resumen ejecutivo

Lexis tiene controles útiles, pero no ofrece aún garantías suficientes para incorporar datos de negocio del segundo usuario. No se ha confirmado una intrusión en producción; sí rutas de alto impacto verificadas en el código.

Las tres correcciones prioritarias son: eliminar ejecución de JavaScript al importar Markdown; cerrar integridad y lecturas entre propietarios; y excluir HTML autenticado del service worker. A continuación deben corregirse el filtro Gmail, la conservación de cambios en conectores y los reintentos de recordatorios.

El control SOP del proyecto devuelve `DRIFT`; no se actualizó durante esta auditoría para respetar su alcance de solo lectura original.
