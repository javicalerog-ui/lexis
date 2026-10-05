# GUÍA — Clave nueva de OpenRouter y cambio a Gemini 3.8 Flash + Sonnet 5.5 · 2026-10-05

**Resultado final:** Lexis vuelve a responder (hoy falla por saldo agotado), con una clave nueva y modelos más nuevos y baratos: rápido `google/gemini-3.8-flash`, profundo `anthropic/claude-sonnet-5.5`.
**Tiempo estimado:** ~10 min · **Necesitas:** acceso a la cuenta de OpenRouter que vayáis a usar, una tarjeta para el saldo y acceso a Vercel (proyecto `lexis`).

## Antes de empezar

| Dato | Valor |
|---|---|
| Modelo rápido (y visión) | `google/gemini-3.8-flash` |
| Modelo profundo | `anthropic/claude-sonnet-5.5` |
| Proyecto Vercel | `lexis` (equipo «javicalerog-gmailcom's projects») |
| Lo ya hecho por Claude | Código y `.env.local` con los modelos nuevos (copia del anterior en `.env.local.bak-2026-10-05`) |

> ⚠️ **Elige la cuenta de OpenRouter antes de empezar** y apúntala en tu Excel de cuentas (`00-sistema-metodo\cuentas\`). La clave actual (`sk-or-v1-679…52e`) es de una cuenta con saldo agotado: si la nueva es otra cuenta (p. ej. corporativa), deja constancia de cuál es.
> 🔒 **La clave nunca se pega en el chat.** Va directa de OpenRouter a tu portapapeles y de ahí a `.env.local` y a Vercel.

---

## Fase 1 — Crear la clave y cargar saldo (pasos 1-4)

### Paso 1 — Añadir saldo
1. Entra en `https://openrouter.ai/settings/credits` con la cuenta elegida.
2. Pulsa **«Add Credits»** y carga la cantidad que decidas (los 10 $ anteriores duraron ~4 semanas con los modelos viejos; con los nuevos deberían durar ~el doble).

✅ Verás: el saldo («Credits») por encima de 0.

### Paso 2 — Activar la recarga automática (recomendado)
1. En esa misma página, busca **«Auto Top-Up»** y actívalo.
2. Pon un umbral (p. ej. «cuando baje de 2 $») y una cantidad de recarga (p. ej. 10 $).

✅ Verás: Auto Top-Up activado. Así Lexis no se vuelve a quedar mudo sin avisar.

### Paso 3 — Crear la clave
1. Entra en `https://openrouter.ai/settings/keys`.
2. Pulsa **«Create API Key»** (arriba a la derecha).
3. Nombre: `lexis-prod`. Límite de crédito: déjalo vacío (o pon un tope mensual si quieres control extra).
4. Pulsa **«Create»**.
5. **Copia la clave** con el botón de copiar (empieza por `sk-or-v1-`). ⚠️ **Solo se muestra una vez**: no cierres la ventana hasta terminar el paso 4.

✅ Verás: la clave en pantalla y copiada al portapapeles.

### Paso 4 — Poner la clave en tu `.env.local` (sin pegarla en ningún sitio)
Con la clave aún en el portapapeles, abre PowerShell y ejecuta (lee el portapapeles y sustituye solo la línea de la clave):

```powershell
$f="C:\Users\ES00500148\Desktop\Proyectos IA\10-lexis-segundo-cerebro\.env.local"; $k=(Get-Clipboard).Trim(); if($k -notmatch '^sk-or-v1-'){ "ERROR: el portapapeles no tiene una clave sk-or-v1-. Vuelve a copiarla." } else { $t=[IO.File]::ReadAllText($f) -replace '(?m)^OPENROUTER_API_KEY=.*$',"OPENROUTER_API_KEY=$k"; [IO.File]::WriteAllText($f,$t,(New-Object Text.UTF8Encoding($false))); "OK clave puesta. Longitud: $($k.Length), empieza: $($k.Substring(0,12))..." }
```

✅ Verás: `OK clave puesta. Longitud: 73, empieza: sk-or-v1-...` (la longitud puede variar un poco; lo importante es que empiece por `sk-or-v1-`).
⚠️ Si ves `ERROR: el portapapeles no tiene una clave`: vuelve a OpenRouter, pulsa copiar otra vez y repite este paso.

**➡️ PARA AQUÍ y escribe «ya está» en el chat.** Claude prueba los modelos nuevos con tu clave (recordatorios y preguntas de cifras con resultado conocido) **antes** de tocar producción.

---

## Fase 2 — Producción en Vercel (pasos 5-6) · solo cuando Claude confirme que las pruebas pasan

### Paso 5 — Actualizar las variables en Vercel
1. Entra en `https://vercel.com` → equipo **«javicalerog-gmailcom's projects»** → proyecto **`lexis`**.
2. Pestaña **«Settings»** → menú lateral **«Environment Variables»**.
3. Para cada variable de la tabla: si ya existe, pulsa **«⋯» → «Edit»**; si no existe, créala con **«Add New»**. Marca los entornos **Production** y **Preview**.

| Variable | Valor |
|---|---|
| `OPENROUTER_API_KEY` | la clave nueva (cópiala de nuevo de tu `.env.local` o del gestor donde la guardaste) |
| `OPENROUTER_MODEL_FAST` | `google/gemini-3.8-flash` |
| `OPENROUTER_MODEL_DEEP` | `anthropic/claude-sonnet-5.5` |
| `OPENROUTER_MODEL_VISION` | `google/gemini-3.8-flash` |

4. Pulsa **«Save»** en cada una.

✅ Verás: las 4 variables en la lista con fecha de hoy.
⚠️ No hace falta pulsar «Redeploy»: Claude publica el cambio de código justo después y ese despliegue ya recoge las variables nuevas.

### Paso 6 — Avisar
Escribe **«Vercel hecho»** en el chat.

---

## Al terminar
Claude publica el código, espera al despliegue y repite **como Silvestre** las preguntas que fallaron (exportaciones a terceros y la pregunta trampa de Jose María), y te enseña las respuestas reales. Después: la clave antigua se puede **borrar** en `https://openrouter.ai/settings/keys` para que no quede viva.
