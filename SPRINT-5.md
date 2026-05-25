# Sprint 5 — Captura por voz

Lexis ahora se puede usar **sin teclado**. Dos piezas:

1. **Voz → texto**: micrófono en chat principal y en entrevistas. El audio se transcribe con Whisper (OpenAI o Groq, intercambiables) y se ingesta por el pipeline normal.
2. **Texto → voz**: cada pregunta del entrevistador tiene un botón ♪ para escucharla. Útil cuando vas caminando o conduciendo y la sesión es larga.

No requiere migración SQL — solo claves API nuevas en el entorno.

---

## Qué se ha implementado

### Núcleo audio

| Módulo | Archivo | Función |
|---|---|---|
| Adapter Whisper | `src/lib/audio/whisper.ts` | `transcribeAudio()` — soporta `openai` (default) y `groq`. Mismo formato multipart, configurable vía `AUDIO_PROVIDER` env |
| Adapter TTS | `src/lib/audio/tts.ts` | `synthesizeSpeech()` — OpenAI tts-1, voz `nova` por defecto |
| Hook grabación | `src/hooks/useMediaRecorder.ts` | Hook reusable con auto-detect de mime type, tope de duración, indicador de nivel de audio (AnalyserNode) |
| VoiceRecorder | `src/components/audio/VoiceRecorder.tsx` | Componente que muestra mic → recording → transcribing → review (opcional) → callback con texto |
| PlayQuestionButton | `src/components/audio/PlayQuestionButton.tsx` | Botón ♪ pequeño que sintetiza TTS on-demand y reproduce |

### API Routes

| Endpoint | Función |
|---|---|
| `POST /api/audio/transcribe` | Multipart con `audio` (max 25MB), opcional `language` y `prompt`. Devuelve `{ text, language, duration, model_used, provider }` |
| `POST /api/audio/tts` | JSON `{ text, voice? }`. Devuelve `audio/mpeg` binario con headers `X-TTS-Voice` y `X-TTS-Provider`. Cacheable en cliente |

### Integración en UI existente

- **ChatInput** (`/`): nuevo botón micrófono junto al send. Modo `reviewBeforeSubmit=false` → la transcripción se inyecta directamente en el textarea (lo concatena si ya escribiste algo). Tras hablar, pulsas enviar normal.
- **InterviewChat** (`/interview/[id]`): mismo VoiceRecorder en el input bar, pero con `reviewBeforeSubmit=true` (las respuestas a entrevistas son más largas y vale la pena revisar la transcripción antes de mandarla). Además, cada burbuja del assistant tiene un botón ♪ que reproduce la pregunta con TTS.

### Hook `useMediaRecorder` — detalles

- Pide permiso `getUserMedia({audio})` con `echoCancellation`, `noiseSuppression`, `autoGainControl`.
- Detecta el mejor mime type soportado en cascada: `audio/webm;codecs=opus` → `audio/webm` → `audio/mp4` → `audio/ogg;codecs=opus`.
- Tope por defecto: 3 minutos. Auto-stop si se excede.
- Audio level via `AnalyserNode` con RMS sobre `getByteTimeDomainData` (60fps). Si el navegador no lo soporta, sigue grabando sin indicador visual.
- Limpia completamente al stop/cancel: para tracks del MediaStream, cierra AudioContext, libera analyser.

### Estados visuales del VoiceRecorder

1. **idle**: icono micro discreto. Click → empieza.
2. **requesting**: muy breve, mientras se pide el permiso.
3. **recording**: badge rojo pulsante, barra vertical animada con el nivel de audio en tiempo real, cronómetro mm:ss, botón ✕ cancelar + botón ■ parar.
4. **transcribing**: dots animados con texto "Transcribiendo…".
5. **review** (solo si `reviewBeforeSubmit=true`): caja con textarea autosize del texto transcrito, botones "Cancelar" y "Usar texto". Útil porque Whisper se equivoca con nombres propios.
6. **error**: mensaje breve, vuelve a idle.

---

## Decisiones técnicas

1. **Provider configurable por env, no en código**: misma API en OpenAI y Groq (Groq es OpenAI-compatible). Cambiar provider sin tocar código.
2. **Groq como alternativa**: free tier muy generoso, Whisper Large v3 a ~4× la velocidad de OpenAI. Si quieres soberanía y bajo coste, Groq es la opción. Para mejor calidad agnóstica, OpenAI.
3. **`reviewBeforeSubmit` diferenciado**: en el chat principal (texto corto, casual) la voz va directa al input — flujo rápido. En entrevista (respuestas largas y reflexivas) se revisa antes de mandar — vale la pena editar las inevitables imprecisiones.
4. **Prompt hint en Whisper**: en el entrevistador pasamos `prompt: "Entrevista en español: nombres propios, proyectos, organizaciones"` para mejorar reconocimiento. Whisper acepta hasta 224 chars de hint que guían el decoding.
5. **TTS sin persistencia**: cada `/api/audio/tts` regenera el audio y lo devuelve como binario con `Cache-Control: private, max-age=3600`. Adicionalmente, el cliente cachea en memoria por `cacheKey` para evitar regenerar si vuelves a pulsar play en la misma sesión.
6. **Coste estimado**:
   - **Whisper** OpenAI: $0.006/min. 1h de uso/día = $0.36/mes.
   - **Whisper** Groq: gratis dentro de su free tier (muy holgado).
   - **TTS** OpenAI tts-1: $15/1M caracteres. Una pregunta media de 100 chars = $0.0015. Botón ♪ usado moderadamente = céntimos/mes.

---

## Cómo probarlo

Tras `npm install` (sin nuevas deps), añadir al `.env.local`:

```bash
# Para transcripción
AUDIO_PROVIDER=openai          # o 'groq' si prefieres
OPENAI_API_KEY=sk-xxx          # required si openai
GROQ_API_KEY=                  # required si groq

# Para TTS (siempre OpenAI por ahora)
TTS_PROVIDER=openai
TTS_VOICE=nova                 # opciones: alloy, echo, fable, onyx, nova, shimmer
TTS_MODEL=tts-1                # tts-1-hd para mejor calidad, 2x precio
```

En Cloudflare Pages, añadir las mismas variables a Settings → Environment variables.

### Smoke tests

1. **Voz en chat principal**:
   - `/` → modo Capturar.
   - Tap micrófono → conceder permiso de audio la primera vez.
   - Grabar "Hoy he tenido una reunión con Alfonso sobre Polonia".
   - Tap ■ stop → debería aparecer en el textarea pasados ~2s.
   - Tap enviar → memoria creada normal.

2. **Voz en entrevista**:
   - `/interview` → crear sesión exploratoria.
   - Esperar primera pregunta.
   - Tap ♪ al lado de "pregunta" → debe sonar la pregunta hablada (Sonnet voice).
   - Tap micrófono → grabar respuesta larga.
   - Stop → aparece **review box** con el texto transcrito y opción de editarlo.
   - Editar nombres propios si Whisper se equivocó.
   - "Usar texto" → reemplaza el draft.
   - Enviar normal.

3. **Probar con Groq** (opcional):
   - Cambiar `.env.local`: `AUDIO_PROVIDER=groq` + `GROQ_API_KEY=...`.
   - Reiniciar `npm run dev`.
   - Probar transcripción de nuevo: notarás que es más rápido.
   - El TTS sigue siendo OpenAI (Groq no tiene TTS).

### Permisos PWA en móvil

- iOS Safari: tras "Add to Home Screen", al primer tap del micrófono pedirá permiso. Si lo niegas, hay que entrar a Ajustes iOS → Safari → Cámara y micrófono.
- Android Chrome: similar flujo. Permiso persistente para el dominio una vez concedido.
- Requiere HTTPS, que Cloudflare Pages provee por defecto. En local con `npm run dev` también funciona en `localhost`.

---

## Pendiente / posibles Sprint 6+

- **Auto-send tras voz en chat principal**: opción en ajustes "enviar automáticamente al transcribir" (en lugar de inyectar al textarea).
- **Streaming TTS**: tts-1 actual es batch; si llega `tts-streaming` o se mueve a Cartesia/ElevenLabs streaming, la latencia del botón ♪ baja a ~300ms.
- **Persistir audio**: opcionalmente subir la grabación a `lexis-raw` y guardarla en `source_metadata` para poder volver a oírla.
- **Detección de voz para auto-stop**: VAD (voice activity detection) en el cliente para parar la grabación sola tras silencio prolongado.
- **TTS para feed / cards**: leer en voz alta una propuesta del feed o un rolling_summary cuando vas en el coche.

---

## Checklist de cierre Sprint 5

- [ ] `OPENAI_API_KEY` (y/o `GROQ_API_KEY`) configuradas en `.env.local` y Cloudflare Pages.
- [ ] Botón micrófono visible en input del chat principal.
- [ ] Botón micrófono visible en input del entrevistador.
- [ ] Botón ♪ visible en cada burbuja del entrevistador.
- [ ] Grabación funciona en local (Chrome desktop con localhost).
- [ ] Transcripción devuelve texto razonable en español en <5s.
- [ ] Review box aparece en entrevistador, no aparece en chat principal.
- [ ] TTS reproduce la pregunta cuando pulsas ♪.
- [ ] PWA instalada en móvil pide permiso de micrófono y graba correctamente.
- [ ] Indicador de nivel de audio se mueve durante la grabación.
