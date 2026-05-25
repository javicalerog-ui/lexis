// =====================================================
// Chunking de textos largos
// Estrategia: trozos de ~1500 tokens (~6000 chars) con
// overlap de ~150 tokens (~600 chars) para preservar
// contexto entre fragmentos.
// =====================================================

const APPROX_CHARS_PER_TOKEN = 4;

export interface ChunkOptions {
  max_tokens?: number;
  overlap_tokens?: number;
}

export function chunkText(
  text: string,
  opts: ChunkOptions = {}
): string[] {
  const maxTokens = opts.max_tokens ?? 1500;
  const overlapTokens = opts.overlap_tokens ?? 150;

  const maxChars = maxTokens * APPROX_CHARS_PER_TOKEN;
  const overlapChars = overlapTokens * APPROX_CHARS_PER_TOKEN;

  const clean = text.replace(/\r\n/g, '\n').trim();
  if (clean.length <= maxChars) return [clean];

  const chunks: string[] = [];
  let start = 0;

  while (start < clean.length) {
    let end = Math.min(start + maxChars, clean.length);

    // Buscar un corte natural (final de párrafo, frase, espacio)
    if (end < clean.length) {
      const slice = clean.slice(start, end);
      const lastBreak = Math.max(
        slice.lastIndexOf('\n\n'),
        slice.lastIndexOf('. '),
        slice.lastIndexOf('? '),
        slice.lastIndexOf('! ')
      );
      if (lastBreak > maxChars * 0.6) {
        end = start + lastBreak + 1;
      }
    }

    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = end - overlapChars;
    if (start < 0) start = 0;
  }

  return chunks.filter(Boolean);
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
}
