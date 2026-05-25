// =====================================================
// Adapter Whisper — transcripción de audio
//
// Compatible con dos providers vía variable de entorno:
//   - 'openai' (default): https://api.openai.com/v1/audio/transcriptions
//   - 'groq': https://api.groq.com/openai/v1/audio/transcriptions (gratis, ~4x más rápido)
//
// Ambos endpoints aceptan el mismo formato (multipart/form-data),
// así que el código es idéntico. Cambia solo URL + key.
// =====================================================

const PROVIDER = (process.env.AUDIO_PROVIDER || 'openai').toLowerCase();

const ENDPOINTS: Record<string, string> = {
  openai: 'https://api.openai.com/v1/audio/transcriptions',
  groq: 'https://api.groq.com/openai/v1/audio/transcriptions',
};

const DEFAULT_MODELS: Record<string, string> = {
  openai: 'whisper-1',
  groq: 'whisper-large-v3',
};

function getCredentials() {
  if (PROVIDER === 'groq') {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new Error('GROQ_API_KEY no configurada');
    return {
      url: ENDPOINTS.groq,
      key,
      model: process.env.WHISPER_MODEL || DEFAULT_MODELS.groq,
    };
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY no configurada');
  return {
    url: ENDPOINTS.openai,
    key,
    model: process.env.WHISPER_MODEL || DEFAULT_MODELS.openai,
  };
}

export interface TranscriptionResult {
  text: string;
  language: string | null;
  duration: number | null;     // segundos
  model_used: string;
  provider: string;
}

interface WhisperVerboseResponse {
  text: string;
  language?: string;
  duration?: number;
}

export async function transcribeAudio(
  audio: Blob | File,
  opts: { language?: string; prompt?: string } = {}
): Promise<TranscriptionResult> {
  const { url, key, model } = getCredentials();

  const form = new FormData();
  // El nombre que damos al campo file es crítico, todos esperan 'file'
  const filename =
    audio instanceof File ? audio.name : `recording-${Date.now()}.webm`;
  form.append('file', audio, filename);
  form.append('model', model);
  form.append('response_format', 'verbose_json');
  if (opts.language) form.append('language', opts.language);
  if (opts.prompt) form.append('prompt', opts.prompt.slice(0, 224));

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      // No setear Content-Type; fetch lo hará con el boundary correcto
    },
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Whisper API error (${res.status}): ${errText.slice(0, 300)}`);
  }

  const json = (await res.json()) as WhisperVerboseResponse;

  return {
    text: json.text?.trim() || '',
    language: json.language ?? null,
    duration: json.duration ?? null,
    model_used: model,
    provider: PROVIDER,
  };
}
