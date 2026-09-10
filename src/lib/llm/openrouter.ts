// =====================================================
// Cliente OpenRouter base
// =====================================================
import type { LLMResponse, LLMTier } from '@/types/domain';

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      >;
}

export interface OpenRouterOptions {
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' };
  // Control del "pensamiento" del modelo. Los modelos actuales (gemini-3.5,
  // claude-4.6) razonan de forma OBLIGATORIA y esos tokens salen del mismo
  // presupuesto que la respuesta: si max_tokens es bajo, el razonamiento se
  // come la salida y esta llega cortada (finish_reason=length). Por defecto
  // pedimos effort 'low' para minimizar ese gasto; aun así hay que dar
  // max_tokens con margen holgado en cada llamada.
  reasoning?: { effort?: 'low' | 'medium' | 'high'; max_tokens?: number };
}

interface OpenRouterRaw {
  id: string;
  model: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

const MAX_RETRIES = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function callOpenRouter(opts: OpenRouterOptions): Promise<{
  text: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
}> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY no configurada');

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(OPENROUTER_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://lexis-henna.vercel.app',
          'X-Title': 'Lexis',
        },
        body: JSON.stringify({
          ...opts,
          temperature: opts.temperature ?? 0.3,
          max_tokens: opts.max_tokens ?? 1024,
          reasoning: opts.reasoning ?? { effort: 'low' },
        }),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (e) {
      // Error de red / timeout → reintenta con backoff
      lastErr = e;
      if (attempt < MAX_RETRIES - 1) await sleep(500 * 2 ** attempt);
      continue;
    }

    // Reintenta en 429 (rate limit) y 5xx (transitorios)
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`OpenRouter ${res.status}`);
      if (attempt < MAX_RETRIES - 1) {
        const retryAfter = Number(res.headers.get('retry-after')) || 0;
        await sleep(retryAfter * 1000 || 500 * 2 ** attempt);
        continue;
      }
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenRouter API error (${res.status}): ${errText.slice(0, 300)}`);
    }

    const json = (await res.json()) as Partial<OpenRouterRaw> & {
      error?: { message?: string };
    };

    // OpenRouter puede devolver 200 con body { error: {...} } y sin choices
    if (json.error || !Array.isArray(json.choices) || !json.choices.length) {
      throw new Error(
        `OpenRouter respuesta inválida: ${json.error?.message || 'sin choices'}`
      );
    }

    const usage = json.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    return {
      text: json.choices[0]?.message?.content || '',
      model: json.model || opts.model,
      prompt_tokens: usage.prompt_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? 0,
    };
  }

  throw new Error(
    `OpenRouter falló tras ${MAX_RETRIES} intentos: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`
  );
}

// Model IDs vigentes en OpenRouter (verificados 2026-05). Overridables por env.
// OJO: los slugs cambian; `google/gemini-3-flash` (sin .5) ya NO existe.
export function modelFor(tier: LLMTier): string {
  if (tier === 'deep') {
    return process.env.OPENROUTER_MODEL_DEEP || 'anthropic/claude-sonnet-4.6';
  }
  return process.env.OPENROUTER_MODEL_FAST || 'google/gemini-3.5-flash';
}

export function visionModel(): string {
  return process.env.OPENROUTER_MODEL_VISION || 'google/gemini-3.5-flash';
}
