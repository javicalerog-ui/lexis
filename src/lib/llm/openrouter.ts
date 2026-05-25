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

export async function callOpenRouter(opts: OpenRouterOptions): Promise<{
  text: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
}> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY no configurada');

  const res = await fetch(OPENROUTER_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://lexis.pages.dev',
      'X-Title': 'Lexis',
    },
    body: JSON.stringify({
      ...opts,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.max_tokens ?? 1024,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter API error (${res.status}): ${errText}`);
  }

  const json = (await res.json()) as OpenRouterRaw;
  return {
    text: json.choices[0]?.message?.content || '',
    model: json.model,
    prompt_tokens: json.usage.prompt_tokens,
    completion_tokens: json.usage.completion_tokens,
  };
}

export function modelFor(tier: LLMTier): string {
  if (tier === 'deep') {
    return process.env.OPENROUTER_MODEL_DEEP || 'anthropic/claude-sonnet-4.6';
  }
  return process.env.OPENROUTER_MODEL_FAST || 'google/gemini-3-flash';
}

export function visionModel(): string {
  return process.env.OPENROUTER_MODEL_VISION || 'google/gemini-3-flash';
}
