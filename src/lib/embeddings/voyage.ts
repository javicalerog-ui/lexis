// =====================================================
// Adapter Voyage AI — embeddings
// Modelo: voyage-4-lite (1024 dims, Matryoshka)
// Docs: https://docs.voyageai.com/reference/embeddings-api
// =====================================================

const VOYAGE_ENDPOINT = 'https://api.voyageai.com/v1/embeddings';

const MODEL = process.env.VOYAGE_MODEL || 'voyage-4-lite';
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

  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error('VOYAGE_API_KEY no configurada');

  const cleaned = texts.map((t) => (t || '').slice(0, 32_000));

  const res = await fetch(VOYAGE_ENDPOINT, {
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
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Voyage API error (${res.status}): ${errText}`);
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
