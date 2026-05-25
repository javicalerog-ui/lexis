// =====================================================
// POST /api/audio/tts
// Body: { text: string, voice?: string }
// Devuelve: audio/mpeg binario
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { synthesizeSpeech } from '@/lib/audio/tts';

export const runtime = 'nodejs';
export const maxDuration = 30;

const Schema = z.object({
  text: z.string().min(1).max(4000),
  voice: z.string().optional(),
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

  try {
    const result = await synthesizeSpeech(body.text, { voice: body.voice });
    return new NextResponse(new Uint8Array(result.audio), {
      headers: {
        'Content-Type': result.content_type,
        'Content-Length': String(result.audio.length),
        'X-TTS-Voice': result.voice,
        'X-TTS-Provider': result.provider,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'tts_failed', detail: String(e) },
      { status: 500 }
    );
  }
}
