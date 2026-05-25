// =====================================================
// Escalación inteligente Fast → Deep
// Si el modelo rápido devuelve baja confianza o estructura
// inválida, reintenta con el modelo profundo.
// =====================================================
import type { LLMCallOptions, LLMResponse, LLMTier } from '@/types/domain';
import { callOpenRouter, modelFor, type OpenRouterMessage } from './openrouter';

const THRESHOLD = Number(process.env.LLM_ESCALATION_THRESHOLD || 0.7);

export async function chat(
  userPrompt: string,
  opts: LLMCallOptions = {}
): Promise<LLMResponse> {
  const tier: LLMTier = opts.tier ?? 'fast';
  const model = modelFor(tier);

  const messages: OpenRouterMessage[] = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  messages.push({ role: 'user', content: userPrompt });

  const result = await callOpenRouter({
    model,
    messages,
    temperature: opts.temperature,
    max_tokens: opts.max_tokens,
    ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
  });

  return {
    text: result.text,
    model_used: result.model,
    tier_used: tier,
    prompt_tokens: result.prompt_tokens,
    completion_tokens: result.completion_tokens,
  };
}

/**
 * Llama primero con Fast; si parsing JSON falla o `confidence` < threshold,
 * reintenta con Deep.
 */
export async function chatWithEscalation<T = unknown>(
  userPrompt: string,
  opts: Omit<LLMCallOptions, 'tier' | 'json'> & {
    schema_hint?: string;
    confidence_field?: keyof T;
  } = {}
): Promise<{ parsed: T; meta: LLMResponse }> {
  // Intento 1: Fast en modo JSON
  const fastResp = await chat(userPrompt, {
    ...opts,
    tier: 'fast',
    json: true,
  });

  const fastParsed = tryParseJson<T>(fastResp.text);
  const fastConfidence = extractConfidence<T>(fastParsed, opts.confidence_field);

  if (fastParsed && fastConfidence >= THRESHOLD) {
    return { parsed: fastParsed, meta: fastResp };
  }

  // Intento 2: Deep
  const deepResp = await chat(userPrompt, {
    ...opts,
    tier: 'deep',
    json: true,
  });
  const deepParsed = tryParseJson<T>(deepResp.text);
  if (!deepParsed) {
    throw new Error('LLM no devolvió JSON parseable ni en Fast ni en Deep');
  }
  return { parsed: deepParsed, meta: deepResp };
}

function tryParseJson<T>(text: string): T | null {
  try {
    const trimmed = text.trim().replace(/^```json\s*|\s*```$/g, '');
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

function extractConfidence<T>(
  obj: T | null,
  field?: keyof T
): number {
  if (!obj || !field) return 1; // sin campo de confianza → siempre aceptar
  const v = obj[field];
  if (typeof v === 'number') return v;
  return 0;
}
