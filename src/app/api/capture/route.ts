// =====================================================
// POST /api/capture
// Recibe una IngestionInput y persiste la memoria.
// Para imágenes: la imagen ya está en Storage, llega
// source_uri y nosotros generamos el caption.
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ingest } from '@/lib/ingestion/pipeline';
import { captionImage, captionToText } from '@/lib/ingestion/image';

export const runtime = 'nodejs';
export const maxDuration = 60;

const Schema = z.object({
  source_type: z.enum(['text', 'voice', 'image', 'pdf', 'xlsx', 'md', 'url']),
  raw_text: z.string().optional(),       // omitido si source_type === 'image'
  source_uri: z.string().optional(),
  source_metadata: z.record(z.unknown()).optional(),
  captured_at: z.string().datetime().optional(),
});

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_body', detail: String(e) },
      { status: 400 }
    );
  }

  let rawText = body.raw_text ?? '';

  // Si es imagen, primero captionamos
  if (body.source_type === 'image') {
    if (!body.source_uri) {
      return NextResponse.json(
        { error: 'source_uri requerido para imágenes' },
        { status: 400 }
      );
    }
    try {
      const caption = await captionImage(body.source_uri);
      rawText = captionToText(caption);
      body.source_metadata = {
        ...(body.source_metadata || {}),
        caption_raw: caption,
      };
    } catch (e) {
      return NextResponse.json(
        { error: 'caption_failed', detail: String(e) },
        { status: 500 }
      );
    }
  }

  if (!rawText.trim()) {
    return NextResponse.json(
      { error: 'raw_text vacío' },
      { status: 400 }
    );
  }

  try {
    const result = await ingest(supabase, user.id, {
      source_type: body.source_type,
      raw_text: rawText,
      source_uri: body.source_uri,
      source_metadata: body.source_metadata,
      captured_at: body.captured_at,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: 'ingest_failed', detail: String(e) },
      { status: 500 }
    );
  }
}
