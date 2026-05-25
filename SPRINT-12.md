# Sprint 12 — Drive Connector

Segundo conector específico sobre el engine del Sprint 10. Reutiliza **100%** el flow OAuth Google del Sprint 11 — el adapter es lo único nuevo, más una pequeña mejora en el flow (adapter_type explícito en el state firmado).

Sin migraciones SQL. Si tu Google Cloud Console ya tenía habilitada la Gmail API y el consent screen con scope `drive.readonly`, Drive funciona sin cambios de configuración.

---

## Setup previo

**Si vienes del Sprint 11**: prácticamente nada que hacer. Solo:

1. **APIs & Services → Library** en Google Cloud Console: habilitar **Google Drive API** si no estaba (Sprint 11 solo pedía Gmail API).
2. **OAuth consent screen**: verificar que el scope `https://www.googleapis.com/auth/drive.readonly` está en la lista. Si no, añadirlo. (Si en Sprint 11 lo añadiste como dejé recomendado, ya está).

**Si Sprint 11 ya estaba autorizado**: cuando crees el primer connector Drive, el flow OAuth te volverá a llevar a Google con consent porque pide un scope adicional. Una vez autorizado, la misma credential Google se actualiza con `gmail.readonly + drive.readonly` mediante el merge idempotente del Sprint 11.

---

## Qué se ha implementado

### Adapter Drive (`src/lib/connectors/adapters/drive.ts`)

**Config schema**:

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `folder_id` | text | (vacío = raíz) | ID de carpeta de Drive. Vacío vigila toda la cuenta |
| `mime_types` | select | `docs` | Combo de tipos: solo Docs / Docs+Sheets / +Slides / +texto plano / Todo (con metadata-only para PDFs/Office) |
| `include_shared` | boolean | `false` | Capturar archivos compartidos contigo además de los propios |
| `include_metadata_only` | boolean | `false` | Para PDFs/Office, capturar solo título + URL (sin texto extraído) |
| `max_per_run` | number | `10` | Tope por ejecución |
| `min_content_length` | number | `100` | Saltar archivos demasiado vacíos |

**Estrategia de sync**:

| State | Comportamiento |
|---|---|
| Primer run (sin `last_page_token`) | Capturar `startPageToken` actual + listar archivos con `modifiedTime > now - 14d` ordenados por modificación descendente |
| Subsiguientes | Drive **Changes API** con el `pageToken` guardado, paginando hasta `maxPerRun * 3` candidatos o agotar |
| Page token caducado (404/410) | Fallback a list query, refrescando el `startPageToken` |

**Tipos procesados**:

| MIME type | Estrategia | source_type |
|---|---|---|
| `application/vnd.google-apps.document` | Export `text/plain` | `text` |
| `application/vnd.google-apps.spreadsheet` | Export `text/csv` | `xlsx` |
| `application/vnd.google-apps.presentation` | Export `text/plain` | `text` |
| `text/plain` | Download directo | `text` |
| `text/markdown` | Download directo | `md` |
| `text/csv` | Download directo | `xlsx` |
| `application/pdf` | Metadata only (solo si flag) | `pdf` |
| Office (`.docx`, `.xlsx`, `.pptx`) | Metadata only (solo si flag) | varía |
| Otros (imagen, video, archivo binario) | Skip |  — |

**Mapeo a memoria**:

- `external_id`: `drive_<file_id>` — dedup automático del Sprint 10
- `content`: `<file.name>\n\n<extracted_text>` truncado a 40 000 caracteres
- `source_uri`: `webViewLink` (link directo a Drive)
- `captured_at`: `modifiedTime` del archivo
- `metadata`: file_id, mime_type, modified_time, created_time, owner_name, owner_email, shared_with_me, size_bytes, folder_ids, content_extracted

**Filtros por mime types** (UI):

El config schema usa un `select` con combos predefinidos en vez de pedir lista cruda al user. Cada combo se expande internamente al array de MIME types apropiados. Más fácil que recordar `application/vnd.google-apps.document` de memoria.

### Detalle de seguridad: capturar `startPageToken` antes del list

En el primer run hacemos esto:

```typescript
// 1. Capturar token ANTES de listar
newStartPageToken = await getStartPageToken(accessToken);

// 2. Listar archivos modificados últimos 14 días
const list = await driveFetch('/files?q=...&orderBy=modifiedTime desc');
```

Si listáramos primero y capturáramos el token después, los cambios que ocurriesen durante el listado se perderían. Capturando el token antes garantizamos que en la siguiente ejecución incremental veremos todos los cambios desde ese punto, incluso si solapan con el primer batch (el dedup por external_id se encarga).

### Mejora del flow OAuth: `adapter_type` explícito

Sprint 11 inferia el adapter type tras el OAuth callback por el `connector_name` (string match contra "drive" / "gmail"). Frágil.

Sprint 12 añade `adapter_type` al payload del state firmado:

- `GET /api/oauth/google/start?adapter_type=drive&...` lo guarda en `state.intent.adapter_type`.
- Callback lo devuelve como query param `?adapter_type=drive` al redirect.
- `NewConnectorClient` lo lee primero, con fallback a la heurística antigua para retrocompatibilidad.

Sin esto, una credencial con scope `drive.readonly` autorizada desde un connector llamado "Mi Backup Gmail" volvería a pick screen como Gmail. Ahora cada flow OAuth sabe a qué adapter pertenece.

### Sección "Próximamente" eliminada

El bloque hardcoded en `NewConnectorClient.tsx` ya no existe (Drive era el único item). El grid de tipos ahora se muestra solo, generado dinámicamente del registry. Cuando llegue un nuevo adapter, basta con registrarlo y aparecerá; no hay placeholders muertos.

El intro de `/connectors` actualizado: ya no dice "próximamente Gmail y Drive", ahora lista los 4 tipos disponibles.

---

## Decisiones técnicas

1. **Combos predefinidos de mime_types en lugar de array libre**: porque pedirle al user que escriba `application/vnd.google-apps.document` es absurdo. Los combos cubren los 5 casos prácticos: solo Docs / Docs+Sheets / + Slides / + texto plano / Todo. Si en el futuro hace falta granularidad, se cambia a multi-select sin tocar el backend.

2. **PDFs y Office como metadata-only por defecto**: extraer texto de PDFs requiere parser (pdf.js, pdf-parse). Office docs (.docx/.xlsx/.pptx) requieren mammoth/exceljs. Para Sprint 12 el coste/beneficio no compensa. Si el user activa `include_metadata_only`, al menos queda registro de qué archivos vio el connector — útil para "sé que existe ese PDF en Drive, déjame buscarlo".

3. **Tracking del `startPageToken` antes del primer list**: detalle clave de correctness. Garantiza que ningún cambio se pierde entre el primer run y el segundo.

4. **`maxPerRun=10` por defecto** (vs 25 de Gmail): los archivos de Drive pueden ser **mucho** más grandes que emails. Un Doc largo + export takes longer + más bytes de embedding + más tokens. 10 es un balance prudente.

5. **`MAX_TEXT_LENGTH = 40_000` chars en download**: la lectura del response se trunca después de 40k chars. Un Doc o Sheet enorme no consume memoria proporcional al tamaño completo. Si el user necesita más, lo abre directamente en Drive vía `source_uri`.

6. **Dedup por external_id, sin re-procesar modificaciones**: el adapter ve un Doc modificado vía Changes API. Si ya existe la memoria, el dedup del runner la skip. **Esto significa que cambios al contenido del Doc después de la primera captura no se reflejan en Lexis**. Aceptable para Sprint 12. Futura mejora: comparar `drive_modified_time` del metadata existente vs el actual y refrescar si cambió.

7. **No procesar carpetas (`application/vnd.google-apps.folder`)**: las carpetas no son "contenido" capturable. Se ignoran implícitamente porque ningún combo de mime_types las incluye.

8. **`include_shared` como segundo list separado**: la query language de Drive no soporta limpio `(folder OR sharedWithMe)` con OR. Hacemos dos lists independientes y dedup por ID antes de procesar.

9. **Sin streaming de los exports**: las llamadas a `/files/{id}/export` devuelven el texto completo. Drive impone su propio límite (~10MB por export). Para texto plano son docenas de miles de palabras, que sobrepasa nuestro cap de 40k chars de todas formas.

10. **Field selection con `fields=` en la query**: cada llamada lista exactamente los campos que vamos a usar (`id,name,mimeType,modifiedTime,...`). Reduce ancho de banda y respuestas más rápidas. Sin esto Drive devuelve docenas de campos por defecto.

---

## Cómo probarlo

### Smoke test 1 — Primer Drive connector con Google ya autorizado en Sprint 11

1. `/connectors/new` → tipo **Google Drive**.
2. Step OAuth:
   - Si tienes credentials de Gmail (Sprint 11), **NO aparecen** en la lista (filtran por scope `drive.readonly` que no tienen).
   - Aparece botón "Conectar con Google".
3. Click → Google muestra consent con scopes pedidos (Drive readonly).
4. Aceptar → callback hace **merge** de scopes en la credential existente: pasa de `[gmail.readonly]` a `[gmail.readonly, drive.readonly]`.
5. Vuelta a `/connectors/new?adapter_type=drive&credentials_id=X&oauth_success=1`.
6. UI detecta `adapter_type=drive` → step configure con badge verde "Cuenta conectada".

### Smoke test 2 — Configurar y ejecutar

1. Configurar:
   - Folder ID: vacío (toda la cuenta) o un ID de carpeta concreta (lo sacas de la URL de Drive al abrir esa carpeta).
   - Mime types: "Solo Google Docs" para test rápido.
   - Schedule: `every:6h`.
2. Crear → ir al detalle del connector.
3. "▷ Ejecutar ahora".
4. Verificar:
   - Status `success`, items_fetched ≤ 10, items_new = items_fetched (primer run).
   - En `/timeline`: aparecen documentos con título + contenido. Source = "Texto". Origin = `connector_drive`.
   - Tap en una memoria capturada → muestra el `source_uri` que abre el Doc en Drive.

### Smoke test 3 — Sync incremental

1. Modificar un Doc dentro del filtro del connector (añadir un párrafo, guardar).
2. En `/connectors/<id>` → "Estado interno" verás `last_page_token: "1234"`.
3. "▷ Ejecutar ahora".
4. Esperado: items_fetched = 1, items_new = 0 (dedup), items_skipped = 1.
5. Debug del run debería decir `"mode": "incremental"`.

**Limitación conocida**: la modificación del Doc no actualiza la memoria existente (Sprint 12 deja esto fuera de scope). Anotado en decisiones técnicas.

### Smoke test 4 — Sheets y CSV

1. Crear un Google Sheet pequeño con 3 columnas, 5 filas, en el folder configurado.
2. Cambiar config del connector → mime_types: "Docs + Sheets".
3. "Ejecutar ahora".
4. Verificar memoria capturada: source_type = `xlsx`, contenido en formato CSV legible.

### Smoke test 5 — Metadata-only para PDFs

1. Subir un PDF al folder.
2. Editar config → mime_types: "Todo (PDFs/Office solo metadata)" + activar `include_metadata_only`.
3. Ejecutar.
4. Verificar memoria: contenido = título + `[Archivo de tipo application/pdf — solo metadatos...]`. source_uri abre el PDF en Drive.

### Smoke test 6 — Refresh idempotente con Sprint 11

Si después de Sprint 12 vuelves a crear un connector Gmail desde cero:

1. `/connectors/new` → Gmail.
2. Step OAuth: ahora **sí aparece** la cuenta Google en "Cuentas ya autorizadas" (porque ya tiene `gmail.readonly` después del merge).
3. Click → salta directamente a configure sin re-OAuth.

Esto valida que el merge de scopes del Sprint 11 sigue funcionando con la actualización de Sprint 12.

---

## Cobertura de tipos de archivo

| Caso de uso | Funciona en Sprint 12 |
|---|---|
| Capturar nuevas notas creadas en Google Docs | ✓ |
| Capturar análisis hechos en Google Sheets | ✓ (como CSV truncado) |
| Capturar presentaciones de Slides | ✓ (texto plano de las diapositivas) |
| Capturar archivos .md / .txt subidos a Drive | ✓ |
| Capturar PDFs adjuntos a Drive | Metadata only (sin texto del PDF) |
| Capturar .docx / .xlsx / .pptx | Metadata only |
| Capturar imágenes con OCR | ✗ (futuro) |
| Capturar vídeos / audios | ✗ (no aplica) |
| Refrescar memoria cuando un Doc se edita | ✗ (futuro, anotado) |

---

## Pendiente / posibles Sprint 13+

- **Parser de PDF**: extraer texto vía `pdf-parse` o similar. Para PDFs OCR-friendly. Resolvería el "metadata-only" en favor de capturar contenido real.
- **Procesar Office docs**: `mammoth` para .docx, `exceljs` o `xlsx` para .xlsx, `pptx-parser` para .pptx.
- **Refrescar memoria cuando la fuente cambió**: comparar `drive_modified_time` del existing vs el actual. Si difiere, UPDATE en vez de skip.
- **Autocomplete de folder_id**: endpoint que liste carpetas del user y la UI lo use con un dropdown searchable en vez del input crudo.
- **Filtros por owner**: capturar solo archivos de los que TÚ eres owner (excluir shared aunque estén en tu folder).
- **Captura de hojas grandes por tabs**: actualmente Drive export devuelve solo el primer sheet en formato CSV. Captura multi-tab sería un futuro.
- **OCR de imágenes en Drive**: si tienes screenshots con texto, Drive ya tiene OCR. Lo podríamos consumir.

---

## Checklist de cierre Sprint 12

- [ ] **Google Drive API** habilitada en Google Cloud Console.
- [ ] Scope `drive.readonly` añadido al OAuth consent screen (en el Sprint 11 ya dejamos esto preparado).
- [ ] `/connectors/new` muestra **Drive** en el grid (ya no en "Próximamente" — sección eliminada).
- [ ] Step OAuth para Drive: si tu credencial Google solo tenía gmail.readonly, te pide re-autorizar añadiendo drive.readonly.
- [ ] Tras autorizar, el merge idempotente actualiza la credential existente (una sola row, scopes acumulados).
- [ ] Ejecutar Drive connector → memorias creadas con `origin: connector_drive`.
- [ ] Configurar mime_types varios → contenido extraído según tipo (Docs como texto, Sheets como CSV).
- [ ] `include_metadata_only=true` captura PDFs como title-only memories.
- [ ] Cron schedule funciona (`POST /api/cron/connectors` ejecuta Drive cuando toca).
- [ ] Second run con cambios incrementales: dedup funcionando, `last_page_token` se actualiza.
