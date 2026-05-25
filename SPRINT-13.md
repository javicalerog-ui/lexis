# Sprint 13 — Mobile-first + onboarding

Capa de usabilidad que faltaba para que Lexis sea real en el día a día. Tres piezas:

1. **PWA instalable de verdad** — manifest completo, service worker con caching strategy, iconos generados desde SVG.
2. **FAB de captura por voz** flotante en todas las páginas no-principales — un tap, dictado, ingest, vuelves donde estabas.
3. **Onboarding documentado** — README maestro + guía de primer día concreta para arrancar con modo B.

Sin migración SQL. Reutiliza el VoiceRecorder existente del Sprint 5 y el endpoint `/api/capture`.

---

## Qué se ha implementado

### PWA instalable

**`public/manifest.json`** completo:
- name + short_name + description
- start_url, scope, display=standalone
- theme_color electric blue (#4f8eff)
- background_color dark (#060812)
- categories, lang=es
- 3 iconos (192, 512, maskable 512)
- 3 **shortcuts** que aparecen al long-press del icono en homescreen: Captura rápida (/), Timeline, Feed proactivo

**`public/sw.js`** service worker con dos estrategias diferenciadas:
- **Navegación HTML** → network-first con fallback a cache. Rápido cuando hay red, funcional cuando no.
- **Assets estáticos** (iconos, _next/static, fuentes) → cache-first con revalidación en background.
- **API calls** → pasan transparente. Nunca cachear endpoints autenticados o dinámicos.
- Versionado: cambiando `CACHE_VERSION` en el SW invalidas todo el cache tras un deploy.
- Fallback offline page minimalista cuando no hay ni cache ni red.

**`public/icon.svg`** — fuente única para todos los iconos. SVG con:
- Background gradient dark + radial bloom accent
- Glyph: tres barras verticales escalonadas (memoria/grafo) + nodo orbital violeta arriba
- Diseñado dentro de la "safe area" del maskable icon (~205 de radio sobre 512)

**`scripts/generate-icons.mjs`** — script Node con `sharp` que genera 6 PNGs desde el SVG:
- `icon-192.png`, `icon-512.png` (PWA estándar)
- `icon-maskable-512.png` (maskable Android)
- `apple-touch-icon.png` (180×180, iOS)
- `favicon-32.png`, `favicon-16.png`
- Comando: `npm run icons`

**`RegisterSW.tsx`** — client component que registra el SW tras el `load`. Solo en producción (en dev no registra para no confundir el HMR).

**Layout root actualizado**:
- Meta tags PWA completos: manifest, applicationName, appleWebApp con statusBarStyle black-translucent
- Iconos referenciados (favicon, apple-touch-icon, 192)
- `viewportFit: 'cover'` para iOS notch
- `formatDetection.telephone: false` para que iOS no convierta números en links auto

### FAB de captura por voz

**`FloatingVoiceCapture.tsx`** — botón flotante visible en todas las páginas excepto:
- `/` (chat principal ya tiene su recorder)
- `/login`
- `/oauth/*`
- `/interview` (entrevistador con su propia UX)

**Comportamiento**:
1. Tap → modal sheet con `VoiceRecorder` del Sprint 5 (sin review-before-submit; el dictado va directo).
2. Voz transcrita → POST a `/api/capture` con `source_type: 'voice'`, metadata `origin: 'fab_voice'`.
3. Pipeline normal: embed Voyage → classifier LLM → projects/entities.
4. Modal pasa a estado "success" con check verde glowing y auto-cierra a los 2.5s.
5. Si hay error, retry sin perder el contexto.

**Atajo de teclado `C`** desde desktop abre el FAB (excepto si estás en un input/textarea).

**Estética**: gradient accent → glow azul/violeta pulsante 2.6s loop. Hover: scale 1.04 + cambio de glow. Active: scale 0.97.

**Móvil**: usa `env(safe-area-inset-bottom)` para no chocar con la home bar de iOS. Tamaño 56px en móviles vs 60px desktop.

### README.md maestro

Sobrescribe el README del Sprint 0. Estructura completa:
- Inicio rápido con link a ONBOARDING
- Tabla del stack
- Variables de entorno divididas en "imprescindibles" vs "habilitan features"
- 9 migraciones SQL en orden con descripción de cada una
- 3 cron jobs y su frecuencia recomendada
- Estructura del proyecto
- **Índice de los 13 sprints** con resumen de 20 palabras por sprint y link al doc detallado
- Comandos npm
- Pasos exactos para deploy en Cloudflare Pages
- Sección filosofía

### ONBOARDING.md — Tu primer día

Guía paso a paso optimizada para **modo B principal** (captura sin fricción móvil), con C/D/A complementarios. Tres bloques:

**Bloque 1 · Setup técnico (45-90 min)**:
- Requisitos previos con links a cuentas free a crear (Supabase, Voyage, OpenRouter, Resend, OpenAI, Google Cloud)
- Clonar e instalar
- Supabase: crear proyecto eu-west-1, habilitar pgvector, aplicar las 9 migraciones en orden exacto
- Crear `.env.local` con orden recomendado de keys
- Generar iconos PWA
- Levantar en dev
- Desplegar en Cloudflare Pages (necesario para PWA móvil)
- Instalar PWA en el móvil (instrucciones iOS Safari + Android Chrome)

**Bloque 2 · Sembrado del grafo (60 min)**:
- Por qué importa el sembrado inicial (problema cold start)
- Sesión fundacional con `/interview` (45-60 min) con plan sugerido en 5 bloques (trabajo IBD, organizacional, Gaiata, proyectos personales, contexto general)
- Verificación del grafo sembrado
- Conectar Drive con tu folder principal
- Conectar Gmail con label "lexis-inbox"
- Configurar digest semanal

**Bloque 3 · Día 2 en adelante**:
- Ritmo diario: mañana (1 min), durante el día (FAB voice cuando salga), preparación reuniones (modo D), domingo (modo C ocasional)
- Atajo `C` para abrir FAB desde teclado
- Métricas de salud cada 2-3 semanas

**Troubleshooting** con 8 síntomas comunes y solución concreta.

**Costes mensuales estimados**: ~$5-15/mes para uso personal con ~30 capturas/día.

### .env.example

Sobrescribe el existente con:
- Comentarios explicando para qué sirve cada variable
- URLs directas para obtener cada key
- Pre-requisitos de Google Cloud Console paso a paso para OAuth (5 pasos)
- Marcado claro de "REQUERIDA" vs "OPCIONAL"
- Comando para generar secrets aleatorios

### package.json

Dos cambios mínimos:
- Script nuevo `"icons": "node scripts/generate-icons.mjs"`
- DevDependency `"sharp": "^0.33.0"`

---

## Decisiones técnicas

1. **Service worker minimalista, no Workbox**: Workbox es la lib estándar pero pesa ~80kB. Nuestras necesidades (network-first HTML + cache-first assets) caben en 150 líneas. Más fácil de auditar y modificar.

2. **SW solo en producción**: registrarlo en dev cachea cosas que después confunden el HMR de Next. Detecta `process.env.NODE_ENV` y skip en development.

3. **Sharp como devDependency**: el script de iconos solo corre cuando regeneras iconos. No queremos sharp en runtime de producción (no aporta nada y pesa ~30MB).

4. **Iconos generados, no comiteados pre-generados**: el SVG es la fuente. Los PNGs se regeneran con `npm run icons`. Esto evita comitear binarios y permite cambiar el branding modificando solo `icon.svg`.

5. **FAB oculto en `/`, `/interview`, `/oauth/*`**: para evitar redundancia (chat principal tiene su recorder, entrevistador también) y conflicto (en OAuth flow no tiene sentido capturar).

6. **`reviewBeforeSubmit={false}` en el FAB**: modo B = sin fricción. No hay paso de revisión antes de enviar. Si la transcripción sale mal, lo verás en `/timeline` y puedes editar/borrar la memoria.

7. **Atajo de teclado `C`**: una sola tecla porque modo B prima velocidad. Detecta si estás en input/textarea/contentEditable para no hijackear escritura normal.

8. **`viewportFit: 'cover'` + safe-area-inset**: el FAB se ajusta automáticamente al notch/home bar de iOS sin que el user tenga que hacer nada.

9. **Shortcuts del manifest**: long-press del icono Lexis en homescreen muestra "Captura rápida", "Timeline", "Feed". Acceso directo sin abrir la app primero.

10. **Onboarding como markdown standalone, no wizard interactivo**: un wizard implementado en la app costaría 200-300 líneas más y se quedaría obsoleto rápido cuando cambies cosas. Un MD es trivial de mantener y se lee mejor en cualquier dispositivo.

---

## Cómo probarlo

### Smoke test 1 — Iconos generados

```bash
rm -rf public/icons        # asegúrate de partir limpio
npm run icons
ls public/icons
# Debería listar: icon-192.png, icon-512.png, icon-maskable-512.png,
#                 apple-touch-icon.png, favicon-32.png, favicon-16.png
```

### Smoke test 2 — Manifest válido

Abre `http://localhost:3000/manifest.json` en el browser. Debe devolver el JSON sin errores. En Chrome DevTools → Application → Manifest verás todos los campos parseados correctamente.

### Smoke test 3 — Service worker (solo producción)

```bash
npm run build
npm run start
```

Abre `http://localhost:3000` en Chrome → DevTools → Application → Service Workers. Verás `sw.js` registrado y activado. En Cache Storage verás `lexis-shell-v1` y `lexis-static-v1`.

Recarga en modo offline (DevTools → Network → "Offline"). La app debe seguir cargando desde el cache. Las APIs darán error (correcto, no se cachean) pero la shell funciona.

### Smoke test 4 — PWA instalable en móvil

Despliega en Cloudflare Pages (necesitas HTTPS). En el móvil:

- **iOS Safari**: botón compartir → "Añadir a pantalla de inicio" → icono Lexis aparece → tap → abre como app nativa sin barra del navegador, con statusbar oscura translúcida.
- **Android Chrome**: banner "Add to home screen" aparece automáticamente. O menú → "Install app".

Long-press del icono Lexis en homescreen debe mostrar los 3 shortcuts (Captura rápida, Timeline, Feed).

### Smoke test 5 — FAB voice

1. Navega a cualquier página que no sea `/` (ej. `/timeline`).
2. Botón redondo flotante visible bottom-right con pulse animado.
3. Tap → modal sheet con grabador.
4. Pulsa el botón de grabar → dicta "esto es una prueba del FAB de voz".
5. Espera transcripción → debe pasar a estado "ingesting" con dots animados.
6. Tras 5-10s, modal pasa a estado verde "Capturado" con check.
7. Auto-cierre a los 2.5s.
8. Ir a `/timeline` → la memoria aparece con `origin: fab_voice`.

### Smoke test 6 — Atajo C en desktop

Estando en `/timeline` o `/dashboard`, pulsa la tecla `C`. El modal del FAB debe abrirse.

Estando dentro de un input (ej. campo de búsqueda en `/connectors/new`), pulsar `C` debe escribir la letra normal, no abrir el FAB.

### Smoke test 7 — FAB oculto donde no debe aparecer

Visita estas rutas y verifica que **no** hay FAB:
- `/`
- `/interview`
- `/oauth/google/error` (si llegas)

En el resto debe estar.

---

## Cuándo regenerar iconos

Cada vez que cambies `public/icon.svg`. `npm run icons` y commit los nuevos PNGs.

Si quieres cambiar el branding completamente:
- Edita el SVG.
- `npm run icons`.
- Actualiza también `theme_color` en `public/manifest.json` y en `viewport.themeColor` del layout si cambias el accent.
- Bumpea `CACHE_VERSION` en `public/sw.js` para forzar reload del cache antiguo.

---

## Checklist de cierre Sprint 13

- [ ] `npm run icons` ejecuta sin errores y genera 6 PNGs en `public/icons/`.
- [ ] `manifest.json` se sirve correctamente y Chrome DevTools lo parsea sin warnings.
- [ ] Service worker se registra en producción (visible en DevTools → Application).
- [ ] Recarga offline en producción → la shell sigue cargando.
- [ ] PWA instalable en iOS Safari → aparece icono Lexis en homescreen → abre como app.
- [ ] PWA instalable en Android Chrome → banner Install aparece.
- [ ] Long-press icono Lexis → 3 shortcuts visibles.
- [ ] FAB visible en todas las páginas excepto `/`, `/interview`, `/login`, `/oauth/*`.
- [ ] Tap FAB → modal abre → graba → transcribe → ingiere → success → auto-cierra.
- [ ] Memoria capturada aparece en `/timeline` con `origin: fab_voice`.
- [ ] Tecla `C` abre FAB desde cualquier página excepto cuando estás en input.
- [ ] `README.md` muestra los 13 sprints en la tabla con resumen de 20 palabras y link.
- [ ] `ONBOARDING.md` se lee bien en móvil y desktop.
- [ ] `.env.example` tiene todas las variables del proyecto con comentarios.
