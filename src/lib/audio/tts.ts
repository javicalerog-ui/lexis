// =====================================================
// Adapter TTS — text-to-speech
//
// Por defecto: OpenAI tts-1 (rápido, barato, multilingüe).
// Alternativa configurable: 'cartesia' (latencia ultra-baja).
//
// Voz por defecto en español: 'nova' o 'shimmer' (femeninas, naturales).
// Configurable vía TTS_VOICE env.
// =====================================================

const PROVIDER = (process.env.TTS_PROVIDER || 'openai').toLowerCase();
const VOICE = process.env.TTS_VOICE || 'nova';
const MODEL = process.env.TTS_MODEL || 'tts-1';

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/audio/speech';

export interface TTSResult {
  audio: Buffer;
  content_type: string;
  voice: string;
  provider: string;
  characters: number;
}

const MAX_TTS_CHARS = 4000;

export async function synthesizeSpeech(
  text: string,
  opts: { voice?: string; format?: 'mp3' | 'opus' | 'aac' | 'flac' } = {}
): Promise<TTSResult> {
  const clean = text.trim();
  if (!clean) throw new Error('Texto vacío para TTS');
  if (clean.length > MAX_TTS_CHARS) {
    throw new Error(`Texto demasiado largo (>${MAX_TTS_CHARS} caracteres)`);
  }

  if (PROVIDER !== 'openai') {
    throw new Error(`TTS provider no soportado: ${PROVIDER}`);
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY no configurada');

  const format = opts.format || 'mp3';
  const voice = opts.voice || VOICE;

  const res = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      voice,
      input: clean,
      response_format: format,
      speed: 1.0,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`TTS API error (${res.status}): ${errText.slice(0, 300)}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return {
    audio: Buffer.from(arrayBuffer),
    content_type: `audio/${format === 'mp3' ? 'mpeg' : format}`,
    voice,
    provider: PROVIDER,
    characters: clean.length,
  };
}
