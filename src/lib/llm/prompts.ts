// =====================================================
// Prompts del sistema
// =====================================================

/**
 * Genera un resumen-MD de una entrada cruda + extracción de metadatos.
 * Output JSON estricto.
 */
export const SUMMARIZE_PROMPT = `Eres un asistente que procesa entradas para un sistema de memoria personal llamado Lexis.

Para la entrada del usuario:
1. Genera un resumen en Markdown breve y objetivo (máximo 3 párrafos, sin floritura).
2. Extrae el contenido principal en una sola frase ("content_normalized"), reescrito en presente y en tercera persona si describe una acción.
3. Identifica menciones de proyectos (work-streams, iniciativas, productos) y entidades (personas, organizaciones, lugares, conceptos).
4. Estima una fecha del hecho relatado si la entrada da pistas; si no, null.
5. Reporta tu nivel de confianza en la extracción (0-1).

Devuelve EXCLUSIVAMENTE un objeto JSON con esta forma exacta:
{
  "summary_md": string,
  "content_normalized": string,
  "projects": string[],
  "entities": Array<{ "name": string, "type": "person"|"org"|"place"|"concept"|"product" }>,
  "captured_at_iso": string | null,
  "confidence": number
}

No incluyas texto fuera del JSON. No uses markdown wrapping (sin \`\`\`json).`;

/**
 * Caption detallado de una imagen para indexación semántica.
 * Output JSON estricto.
 */
export const IMAGE_CAPTION_PROMPT = `Eres un módulo de visión para Lexis. Vas a recibir una imagen.

Devuelve EXCLUSIVAMENTE un objeto JSON:
{
  "description": string,        // descripción rica y específica, 2-4 frases
  "ocr_text": string | null,    // texto detectado en la imagen (si lo hay)
  "objects": string[],          // 3-8 elementos clave visibles
  "scene_type": "photo"|"screenshot"|"diagram"|"document"|"plan"|"chart"|"other",
  "people_mentioned": string[], // si hay personas con nombre visible o reconocibles por contexto
  "tags": string[],             // 3-6 tags útiles para búsqueda
  "confidence": number          // 0-1
}

Sé concreto: di "gaiata festera con pancartas amarillas en calle peatonal" en vez de "imagen de un evento".
Si no puedes determinar algo, usa null o array vacío.
No incluyas texto fuera del JSON.`;

/**
 * Convierte una query del usuario en una query semánticamente normalizada
 * para vectorizar (mejora el recall en muchos sistemas).
 */
export const QUERY_REWRITE_PROMPT = `Reescribe la siguiente consulta del usuario en una frase declarativa apta para búsqueda semántica.
Mantén términos específicos, nombres propios y entidades. No añadas información que no esté en la consulta.
Devuelve solo la frase reescrita, sin comillas ni explicación.

Consulta original: `;
