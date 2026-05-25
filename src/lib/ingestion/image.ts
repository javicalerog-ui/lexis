// =====================================================
// Pipeline de imagen (server-side)
// 1. La imagen ya está en Supabase Storage (URL recibida).
// 2. Llama a Gemini Flash vision vía OpenRouter con la URL.
// 3. Recibe caption + OCR + metadatos + tags.
// 4. El caller embebe esto como texto.
// =====================================================

import { callOpenRouter, visionModel } from '@/lib/llm/openrouter';
import { IMAGE_CAPTION_PROMPT } from '@/lib/llm/prompts';

export interface ImageCaption {
  description: string;
  ocr_text: string | null;
  objects: string[];
  scene_type: string;
  people_mentioned: string[];
  tags: string[];
  confidence: number;
}

export async function captionImage(publicUrl: string): Promise<ImageCaption> {
  const result = await callOpenRouter({
    model: visionModel(),
    temperature: 0.2,
    max_tokens: 800,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: IMAGE_CAPTION_PROMPT },
          { type: 'image_url', image_url: { url: publicUrl } },
        ],
      },
    ],
    response_format: { type: 'json_object' },
  });

  const cleaned = result.text.trim().replace(/^```json\s*|\s*```$/g, '');
  try {
    return JSON.parse(cleaned) as ImageCaption;
  } catch (e) {
    throw new Error(`Caption no parseable: ${cleaned.slice(0, 200)}`);
  }
}

/**
 * Convierte el caption en un único texto listo para embed.
 * El embed buscará por descripción + OCR + objetos + tags simultáneamente.
 */
export function captionToText(c: ImageCaption): string {
  const parts = [
    c.description,
    c.ocr_text ? `Texto en imagen: ${c.ocr_text}` : '',
    c.objects.length ? `Objetos: ${c.objects.join(', ')}` : '',
    c.tags.length ? `Tags: ${c.tags.join(', ')}` : '',
    c.people_mentioned.length
      ? `Personas: ${c.people_mentioned.join(', ')}`
      : '',
  ].filter(Boolean);
  return parts.join('\n');
}
