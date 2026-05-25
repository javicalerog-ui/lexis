# Sprint 9 — Lexis como plataforma personal

**Soberanía + extensibilidad**. Tres piezas que convierten Lexis en una pieza más de tu stack, no en una caja cerrada.

1. **Export completo** del grafo como JSON descargable, con filtros opcionales.
2. **API pública v1** autenticable con Personal Access Tokens, scoped y revocable.
3. **Gestión de tokens** en `/settings/tokens` con creación, revocación y auditoría de uso.

Encaja con tu setup actual (n8n self-host, scripts, VPS, Ollama): ahora puedes alimentar Lexis desde cualquier lado y leer su grafo desde cualquier lado.

---

## Qué se ha implementado

### Migración (`supabase_migrations/20260522000007_sprint9_api_tokens.sql`)

Tabla `personal_access_tokens`:

| Columna | Para qué |
|---|---|
| `name` | Identificación humana ("n8n production", "mi laptop") |
| `token_hash` | SHA-256 hex del token plano. **Nunca guardamos el plano** |
| `token_prefix` | Primeros 8 chars (`pat_xxxx`) — visible en la UI para identificar |
| `token_last_four` | Últimos 4 chars — visible en la UI |
| `scopes pat_scope[]` | Array de `'read'` y/o `'write'` |
| `last_used_at`, `last_used_ip`, `last_used_user_agent` | Auditoría |
| `expires_at` | Opcional, null = sin caducidad |
| `revoked_at` | Null = activo |

RLS habilitado: el user solo ve/gestiona sus propios tokens.

Función `bump_pat_last_used(hash, ip, ua)` con `SECURITY DEFINER` que actualiza last_used sin pasar por RLS (la API ya autenticó el token contra el hash).

### Personal Access Tokens (`src/lib/api-v1/tokens.ts`)

- `generateToken()` produce `pat_<64 chars hex>` (128 bits de entropía).
- `hashToken(plain)` SHA-256 hex.
- `isValidTokenFormat()` valida estructura antes de tocar DB (evita hashing innecesario).

**Estrategia de almacenamiento**: el token plano se devuelve UNA SOLA VEZ en `POST /api/tokens`. Después solo se ve `prefix...last4`. Si el user lo pierde, debe revocarlo y crear uno nuevo.

### API auth middleware (`src/lib/api-v1/auth.ts`)

`authenticateApiRequest(req, requiredScope?)` devuelve `AuthContext | NextResponse`:

- Parsea `Authorization: Bearer pat_xxx`.
- Hash + lookup por `token_hash`.
- Valida no revocado, no expirado, scope suficiente.
- Bump `last_used_at` asíncrono (sin bloquear la respuesta).
- Devuelve `{ user_id, token_id, scopes, supabase }` con **service role client**.

**Importante**: la API usa service role (salta RLS). Cada query DEBE filtrar manualmente por `user_id`. Esto está hecho en cada endpoint v1.

### API v1 endpoints

| Endpoint | Scope | Función |
|---|---|---|
| `POST /api/v1/memories` | write | Captura via API. Pasa por el pipeline normal (Voyage embed → classifier → projects/entities) |
| `GET /api/v1/memories` | read | Lista paginada (limit + offset), con filtros `?since`, `?source_type` |
| `POST /api/v1/search` | read | Búsqueda semántica + filtros (mismo shape que `/api/search`) |
| `GET /api/v1/projects` | read | Lista de proyectos con rolling_summary y next_steps |
| `GET /api/v1/entities` | read | Lista de entidades con key_facts, interaction_count |

Todas devuelven JSON con shape consistente: `{ items, count, total?, limit, offset }`.

### Gestión de tokens (sesión normal)

| Endpoint | Función |
|---|---|
| `GET /api/tokens` | Lista tokens del usuario (sin plain text) |
| `POST /api/tokens` | Crea un nuevo. Devuelve `{ token, plain_text, warning }` — el plain solo aparece esta vez |
| `DELETE /api/tokens/[id]` | Revoca (no borra). Setea `revoked_at = now()` |

### Export (`src/lib/export/build.ts` + `/api/export`)

`buildExport(supabase, userId, filters)` agrega en JSON estructurado:

- `meta` con schema_version, timestamps, counts.
- `projects[]` con rolling_summary, next_steps, etc.
- `entities[]` con key_facts, summary_payload, interaction_count.
- `memories[]` con o sin embeddings (controlado por flag).
- `memory_projects[]`, `memory_entities[]` (relaciones).
- `interview_sessions[]`, `interview_messages[]` (opcional, default true).
- `digests[]` (opcional, default true).

**Paginación interna**: páginas de 1000 rows con loop hasta agotar. Para grafos `<100k` memorias va bien. Para grafos grandes habría que streaming JSON (futuro).

**Chunking en relaciones**: las queries `IN (...)` se parten en chunks de 500 IDs para evitar el límite de Postgres.

**`POST /api/export`** acepta auth de **sesión normal O PAT** (read scope). Devuelve el JSON con `Content-Disposition: attachment` para descarga directa. Headers extra: `X-Memory-Count`, `X-Schema-Version` para integraciones.

**`GET /api/export`** devuelve metadatos (counts estimados, tablas disponibles, schema version) sin generar el dump. Útil para CLI scripts que quieran saber el tamaño antes.

### UI

**`/settings/tokens`** (icono ⚙ en header):

- CTA grande "+ Crear token nuevo" si no hay form abierto.
- **Form** con campos: nombre, scopes (checkboxes en chips coloreados — read accent, write violet), caducidad (pills: Sin caducidad / 30d / 90d / 365d).
- **Después de crear**: banner verde glowing con el token plano en monospace + botón "Copiar" + aviso de que no podrás verlo otra vez.
- **Lista de activos**: cada token con nombre, mask (`pat_abcd…wxyz`), scopes como pills, "usado hace 2h desde 1.2.3.4", "creado el 12 mayo", "caduca el ..." si aplica. Botón "Revocar" con confirm.
- **Lista de revocados** (colapsada visualmente con opacity 0.6).
- **Sección documentación** con ejemplos de curl reales del dominio actual.

**`/export`** (icono ⤒ en header):

- Stats row con conteos en cards (memorias en accent, otras normales). Las que no se incluyen aparecen mutadas.
- Card de configuración con toggles para incluir interviews / digests / embeddings (este último con warning porque infla mucho el tamaño).
- Rango de fechas opcional (inputs date HTML5).
- Estimación de tamaño en tiempo real (~0.6 KB/memoria + 10 KB extra si embeddings).
- Botón "Descargar JSON" con dots loading. Tras éxito muestra: "Exportadas N memorias en X MB".
- Card CLI con ejemplo de curl que **incluye dinámicamente los toggles actuales** (cambia el body JSON según lo que tengas seleccionado).

### Header expandido

Añadidos ⤒ (Export) y ⚙ (Tokens). El header ya tenía scroll horizontal silencioso del Sprint 8 — sigue funcionando con 10 elementos.

---

## Decisiones técnicas

1. **SHA-256 directo, no bcrypt**: los PATs son alta entropía (128 bits random), no contraseñas humanas. SHA-256 es suficiente y rapidísimo (sub-ms vs decenas de ms con bcrypt). Crítico porque el hash se computa en cada request API.

2. **Service role en API v1**: porque los PATs reemplazan la auth de Supabase. El user_id viene del token validado, no de la sesión. Cada query filtra explícitamente `eq('user_id', auth.user_id)`. Si quisieras RLS, habría que generar JWTs propios firmados con el secret de Supabase — más complejo y sin ganancia real (el bug de olvidar el filtro es el mismo riesgo en ambos casos).

3. **Bump `last_used_at` asíncrono**: la auditoría no debería bloquear la respuesta. Se dispara la RPC y la promesa se descarta. Si falla, no pasa nada — la próxima petición lo bumpea.

4. **`SECURITY DEFINER` en `bump_pat_last_used`**: el service client podría hacerlo directamente, pero la función `SECURITY DEFINER` es más fácil de auditar (la lógica completa está en SQL) y permitiría más adelante exponerla a clientes con permisos limitados.

5. **Token plain devuelto UNA SOLA VEZ**: estándar de la industria (GitHub, Linear, Notion). No hay opción de "ver token". Si lo pierdes, revocas y creas. La UI lo deja muy claro con banner warning.

6. **Export con auth dual (sesión O PAT)**: porque el export tiene dos casos de uso muy distintos: descarga manual desde browser (sesión) y backup automatizado vía cron en tu n8n/script (PAT). Mismo endpoint, mismo código.

7. **Schema version en el export**: `1.0`. Si en el futuro cambiamos la forma del JSON, podemos importar versiones antiguas con migración explícita. Por ahora solo es campo informativo.

8. **No incluir embeddings por defecto**: 1024 floats × N memorias = grande rápido (1000 memorias = ~12 MB extra solo de embeddings). El user solo los necesita si va a replicar la búsqueda semántica en otro sitio. Opt-in con warning visible.

9. **CLI code-block dinámico**: la página de export muestra el comando curl con los toggles seleccionados aplicados. Copy-paste directo funciona sin tener que reconfigurar. Detalle pero le da sensación de producto pulido.

10. **Tokens no se borran, se revocan**: importante para auditoría. Si tienes un token comprometido y lo revocas, sigues viendo en el panel que existió. Borrarlo del todo perdería esa información.

---

## Cómo probarlo

Tras aplicar la migración Sprint 9:

### Smoke test 1 — Crear y usar token

1. Ir a `/settings/tokens` (icono ⚙ en header).
2. "+ Crear token nuevo" → nombre "Test", scopes read+write, sin caducidad.
3. Aparece banner verde con el plain. Copiar.
4. En terminal:

```bash
# Variable de entorno con tu token
export LEXIS_PAT="pat_xxx..."
export LEXIS_URL="http://localhost:3000"   # o tu dominio

# Capturar memoria
curl -X POST -H "Authorization: Bearer $LEXIS_PAT" \
  -H "Content-Type: application/json" \
  -d '{"content": "Test desde curl"}' \
  $LEXIS_URL/api/v1/memories

# Listar memorias recientes
curl -H "Authorization: Bearer $LEXIS_PAT" \
  "$LEXIS_URL/api/v1/memories?limit=5"

# Buscar
curl -X POST -H "Authorization: Bearer $LEXIS_PAT" \
  -H "Content-Type: application/json" \
  -d '{"query": "test"}' \
  $LEXIS_URL/api/v1/search
```

5. Volver a `/settings/tokens` → ver que `last_used_at` muestra "hace unos segundos" y el IP/UA correctos.

### Smoke test 2 — Scopes

1. Crear token solo con scope `read`.
2. Intentar capturar:

```bash
curl -X POST -H "Authorization: Bearer $LEXIS_READ_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "esto debería fallar"}' \
  $LEXIS_URL/api/v1/memories
```

Esperado: `403 Forbidden`, `{"error":"forbidden","detail":"Token lacks \"write\" scope","scopes":["read"]}`.

### Smoke test 3 — Export desde browser

1. Ir a `/export` (icono ⤒ en header).
2. Verificar conteos en cards.
3. Toggle "Embeddings" → estimación de tamaño se infla.
4. Configurar rango de fechas → estimación no cambia (es global), pero el export sí lo aplicará.
5. "Descargar JSON" → archivo `lexis-export-YYYY-MM-DD.json` se descarga.
6. Inspeccionar JSON: validar `meta.counts`, ver memorias con todas las relaciones.

### Smoke test 4 — Export vía CLI

```bash
curl -X POST -H "Authorization: Bearer $LEXIS_PAT" \
  -H "Content-Type: application/json" \
  -d '{
    "include_interviews": true,
    "include_digests": false,
    "include_embeddings": false,
    "date_from": "2026-01-01T00:00:00Z"
  }' \
  $LEXIS_URL/api/export \
  -o lexis-backup-$(date +%Y-%m-%d).json

# Inspeccionar
jq '.meta' lexis-backup-*.json
jq '.memories | length' lexis-backup-*.json
```

### Smoke test 5 — Revocación

1. En `/settings/tokens`, revocar un token.
2. Intentar usarlo en curl:

```bash
curl -H "Authorization: Bearer $REVOKED_TOKEN" $LEXIS_URL/api/v1/memories
```

Esperado: `401 Unauthorized`, `{"error":"unauthorized","detail":"Token revoked"}`.

---

## Casos de uso prácticos

### n8n capturando desde Gmail

Workflow:
1. **Trigger**: Gmail trigger con label "lexis-inbox".
2. **HTTP Request**: POST `https://lexis.tu-dominio.com/api/v1/memories` con header `Authorization: Bearer {{ $env.LEXIS_PAT }}` y body:
```json
{
  "content": "{{ $json.subject }}\n\n{{ $json.snippet }}",
  "source_type": "text",
  "source_metadata": {
    "origin": "gmail_via_n8n",
    "from": "{{ $json.from }}",
    "thread_id": "{{ $json.threadId }}"
  }
}
```

### Backup automatizado

Cron diario en VPS:
```bash
#!/bin/bash
curl -X POST -H "Authorization: Bearer $LEXIS_PAT" \
  -H "Content-Type: application/json" \
  -d '{}' \
  https://lexis.tu-dominio.com/api/export \
  -o "/backups/lexis/lexis-$(date +%Y-%m-%d).json"

# Mantener solo últimos 30 días
find /backups/lexis -name 'lexis-*.json' -mtime +30 -delete
```

### Cliente Python ligero

```python
import requests

class LexisClient:
    def __init__(self, pat: str, base_url: str):
        self.s = requests.Session()
        self.s.headers["Authorization"] = f"Bearer {pat}"
        self.base = base_url.rstrip("/")

    def capture(self, content: str, **metadata):
        return self.s.post(
            f"{self.base}/api/v1/memories",
            json={"content": content, "source_metadata": metadata}
        ).json()

    def search(self, query: str, **filters):
        return self.s.post(
            f"{self.base}/api/v1/search",
            json={"query": query, "filters": filters}
        ).json()

# Uso
lexis = LexisClient(os.environ["LEXIS_PAT"], "https://lexis.tu-dominio.com")
lexis.capture("Reunión con cliente sobre Polonia")
```

---

## Pendiente / posibles Sprint 10+

- **Webhooks salientes**: registrar URLs que reciban eventos (`memory.created`, `project.updated`, `digest.sent`). Útil para n8n reactivo en lugar de polling.
- **OAuth2 propio** sobre la API v1 (alternativa a PATs para apps de terceros).
- **Rate limiting**: por token, sliding window.
- **Endpoints v1 adicionales**: `/api/v1/projects/[slug]`, `/api/v1/entities/[id]`, `/api/v1/feed`, `/api/v1/next-steps`.
- **Import via API**: endpoint que acepta el formato del export para sincronización bidireccional.
- **Storage signed URLs vía API**: para imágenes y archivos.
- **Audit log**: ver últimas N llamadas por token con response code, tamaño, etc.

---

## Checklist de cierre Sprint 9

- [ ] Migración `20260522000007_sprint9_api_tokens.sql` aplicada.
- [ ] `/settings/tokens` carga, permite crear token nuevo.
- [ ] Token plain se muestra una vez y nunca más.
- [ ] curl con token funciona en `/api/v1/memories` GET y POST.
- [ ] curl con token de solo `read` falla con 403 al intentar POST.
- [ ] curl con token revocado falla con 401 "Token revoked".
- [ ] `last_used_at`, `last_used_ip`, `last_used_user_agent` se actualizan correctamente.
- [ ] `/export` muestra conteos reales y permite descargar JSON.
- [ ] El JSON descargado contiene memorias + relaciones correctas.
- [ ] Toggle "embeddings" infla el archivo notablemente.
- [ ] `POST /api/export` vía CLI con PAT funciona.
- [ ] Header del chat muestra ⤒ (Export) y ⚙ (Tokens).
