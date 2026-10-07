// =====================================================
// Adapter de embeddings — modelo voyage-4-lite (1024 dims, Matryoshka)
//
// RUTA POR DEFECTO: OpenRouter (2026-10-07). Se usa el MISMO modelo
// `voyageai/voyage-4-lite` que servía Voyage directo: verificado que con
// output_dimension+input_type los vectores son idénticos (coseno = 1,0), así que
// las memorias ya guardadas siguen siendo compatibles sin recargar nada. Ventaja:
// se paga del crédito de OpenRouter (ya configurado) y se evita el límite de 3
// peticiones/min de la cuenta gratuita de Voyage, que es lo que hacía fallar la
// 3ª pregunta seguida. Para volver a Voyage directo: EMBEDDINGS_PROVIDER=voyage.
// Docs Voyage: https://docs.voyageai.com/reference/embeddings-api
// =====================================================

const VIA_OPENROUTER = (process.env.EMBEDDINGS_PROVIDER || 'openrouter') !== 'voyage';

const EMBED_ENDPOINT = VIA_OPENROUTER
  ? 'https://openrouter.ai/api/v1/embeddings'
  : 'https://api.voyageai.com/v1/embeddings';

const MODEL =
  process.env.VOYAGE_MODEL ||
  (VIA_OPENROUTER ? 'voyageai/voyage-4-lite' : 'voyage-4-lite');
const DIMENSIONS = Number(process.env.VOYAGE_DIMENSIONS || 1024);

interface VoyageResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { total_tokens: number };
}

export type EmbedInputType = 'document' | 'query';

/**
 * Embebe uno o varios textos con voyage-4-lite.
 * - `input_type: 'document'` para textos que se almacenan
 * - `input_type: 'query'` para queries del usuario
 * El modelo se entrena con instrucciones distintas según el tipo.
 */
export async function embed(
  texts: string[],
  inputType: EmbedInputType = 'document'
): Promise<number[][]> {
  if (!texts.length) return [];

  const apiKey = VIA_OPENROUTER
    ? process.env.OPENROUTER_API_KEY
    : process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error(
      VIA_OPENROUTER
        ? 'OPENROUTER_API_KEY no configurada (embeddings via OpenRouter)'
        : 'VOYAGE_API_KEY no configurada'
    );
  }

  const cleaned = texts.map((t) => (t || '').slice(0, 32_000));

  // Timeout defensivo: sin él, un Voyage colgado bloquea la función serverless
  // hasta que Vercel la mata (504 no-JSON). 20s cubre de sobra un embed normal.
  const res = await fetch(EMBED_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: cleaned,
      model: MODEL,
      input_type: inputType,
      output_dimension: DIMENSIONS,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Voyage API error (${res.status}): ${errText.slice(0, 300)}`);
  }

  const json = (await res.json()) as VoyageResponse;
  const vecs = json.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);

  // El schema pgvector es vector(1024). Si el modelo/dim devuelven otra cosa,
  // el INSERT fallaría con un error críptico de dimensión: fallar aquí, claro.
  for (const v of vecs) {
    if (v.length !== DIMENSIONS) {
      throw new Error(
        `Voyage devolvió embeddings de ${v.length} dims, esperado ${DIMENSIONS}. ` +
          `Revisa VOYAGE_MODEL (${MODEL}) y VOYAGE_DIMENSIONS.`
      );
    }
  }
  return vecs;
}

export async function embedOne(
  text: string,
  inputType: EmbedInputType = 'document'
): Promise<number[]> {
  const [vec] = await embed([text], inputType);
  return vec;
}

/**
 * Embebe en lotes respetando límite de batch (Voyage acepta hasta 128).
 */
export async function embedBatch(
  texts: string[],
  inputType: EmbedInputType = 'document',
  batchSize = 100
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const chunk = texts.slice(i, i + batchSize);
    const vecs = await embed(chunk, inputType);
    out.push(...vecs);
  }
  return out;
}
