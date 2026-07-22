# Lexis · contención P0 de credenciales y cron

Fecha: 2026-07-22  
Estado del código: remediado localmente; pendiente de operación externa controlada  
Alcance: `connector_credentials`, OAuth Google, API keys de connectors y autenticación de `/api/cron/*`

## Qué queda contenido en el código

- `access_token`, `refresh_token` y `api_key` se cifran antes de persistirse con AES-256-GCM, nonce aleatorio y autenticación ligada al campo y al ID de su fila para impedir intercambios de ciphertext entre credenciales.
- El sobre incluye versión e identificador no secreto de clave (`enc:v1`) para permitir rotación.
- Falta de clave, clave incorrecta, manipulación o una fila heredada en texto plano cierran la operación; nunca se devuelve el secreto como fallback.
- Las lecturas runtime que solicitan columnas secretas pasan por el módulo compartido: primero se elige la fila con metadatos no secretos y después se carga y descifra solo esa fila. Las consultas de listado y el borrado no materializan secretos.
- El callback OAuth no solicita el `refresh_token` almacenado cuando Google entrega uno nuevo. Solo en ausencia de token nuevo hace una lectura condicional del campo y lo descifra, rechazando texto plano o sobres inválidos antes de usarlo.
- El refresh OAuth vuelve a cifrar los tokens antes de escribirlos.
- El callback OAuth comprueba que el cifrado está disponible antes de consumir el código y ya no incluye detalles internos del proveedor en la URL de error.
- Los cuatro endpoints cron comparten un único contrato: `Authorization: Bearer <CRON_SECRET>`, comparación constante y mínimo de 32 bytes.
- Los Personal Access Tokens no requieren esta migración: ya se guardan como hash. Los webhook secrets también permanecen como hash.

## Ventana de mantenimiento para migrar las filas remotas

No se ha ejecutado esta operación desde la auditoría. Requiere acceso autorizado al proyecto Supabase y al gestor de secretos.

1. Desactivar temporalmente los cuatro triggers cron y bloquear nuevas autorizaciones OAuth durante la ventana.
2. Confirmar que existe una recuperación administrada de Supabase con acceso restringido. No crear un volcado local en texto plano.
3. Generar una clave independiente de 32 bytes y guardarla en el gestor de secretos:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

4. Configurar `CONNECTOR_CREDENTIALS_ENCRYPTION_KEY` en el entorno local autorizado y en el entorno de producción. No reutilizar `CRON_SECRET`, `OAUTH_STATE_SECRET` ni otra clave.
5. Con `.env.local` apuntando al Supabase correcto, ejecutar primero el preflight, que solo informa de recuentos:

   ```bash
   npm run credentials:migrate:plan
   ```

6. Si el preflight no presenta errores, aplicar durante la ventana:

   ```bash
   npm run credentials:migrate:apply
   npm run credentials:migrate:plan
   ```

   La segunda ejecución debe indicar `Rows requiring migration: 0`. El script hace preflight de todas las filas antes de escribir y nunca imprime secretos; es idempotente, por lo que se puede reanudar si una actualización remota falla.

7. Desplegar inmediatamente el código endurecido. Hasta completar migración y despliegue, mantener connectors y OAuth en mantenimiento para evitar que el runtime antiguo cree nuevas filas planas o intente usar ciphertext como token.
8. Hacer smoke test de un connector Google y del calendario. Una consulta de comprobación segura puede contar filas sin devolver valores:

   ```sql
   select
     count(*) filter (where access_token is not null and access_token not like 'enc:v1:%') as access_plain,
     count(*) filter (where refresh_token is not null and refresh_token not like 'enc:v1:%') as refresh_plain,
     count(*) filter (where api_key is not null and api_key not like 'enc:v1:%') as api_key_plain
   from connector_credentials;
   ```

   Los tres recuentos deben ser cero.

9. Validar que los cuatro cron devuelven `401` con header ausente/incorrecto y funcionan con el Bearer nuevo; después reactivar triggers.

## Rotaciones externas obligatorias tras el despliegue

Estas acciones invalidan copias históricas que el cifrado por sí solo no puede retirar. No constan como realizadas:

- Rotar `CRON_SECRET` por uno nuevo de al menos 32 bytes y actualizar runtime y scheduler en la misma ventana.
- Revocar las autorizaciones Google existentes usadas por Lexis y volver a autorizar cada cuenta para obtener tokens nuevos, ya almacenados cifrados.
- Inventariar las filas con `api_key is not null`; rotar cada API key en su proveedor y actualizarla mediante un flujo que cifre antes de persistir.
- Rotar `GOOGLE_OAUTH_CLIENT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` y restantes claves de infraestructura solo si salieron del gestor de secretos, aparecieron en un backup/log compartido o existe otra evidencia de exposición. La mera presencia de `.env.local` ignorado por Git no demuestra esa exposición.

## Rotación futura de la clave de cifrado

1. Configurar la nueva clave como `CONNECTOR_CREDENTIALS_ENCRYPTION_KEY` y la actual como `CONNECTOR_CREDENTIALS_PREVIOUS_KEY`.
2. Ejecutar plan, apply y plan hasta obtener cero pendientes.
3. Desplegar con la nueva clave y la anterior durante el smoke test.
4. Retirar `CONNECTOR_CREDENTIALS_PREVIOUS_KEY` de todos los entornos y repetir tests.

No borrar la clave anterior antes de que todas las filas hayan sido reenvueltas y verificadas: el diseño falla cerrado si no reconoce el identificador de clave.

## Evidencia y límites

- Se verificó por nombre y control de Git que `.env.local` está ignorado y no rastreado; no se leyó ni copió ningún valor.
- `npm test`: 13/13 regresiones superadas. Además del cifrado y cron, cubren selección por metadatos sin materializar secretos, carga de una sola fila, rechazo de texto plano y las dos ramas del refresh OAuth.
- `node node_modules/typescript/bin/tsc --noEmit`: superado.
- `node node_modules/next/dist/bin/next lint`: superado con la configuración `next/core-web-vitals`; quedan tres avisos preexistentes no bloqueantes (`no-img-element` y dependencias de hooks).
- Build de producción de Next.js: completado; permanecen dos avisos CSS preexistentes de Autoprefixer sobre `end` frente a `flex-end`, sin relación con esta contención.
- La migración y las rotaciones remotas no se ejecutaron.
- La validación local cubre cifrado/descifrado, tamper detection, rechazo de texto plano, rotación con clave previa, acceso selectivo a secretos, refresh OAuth y el contrato Bearer de cron.
- El migrador es la única excepción deliberada que lee filas heredadas en texto plano: lo hace durante la ventana controlada para cifrarlas, sin imprimir valores, y nunca es una ruta runtime.
