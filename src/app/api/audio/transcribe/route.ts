// =====================================================
// POST /api/audio/transcribe
// Recibe audio (multipart/form-data) y devuelve texto.
//
// Form fields:
//   - audio: File (webm, mp3, m4a, wav...)
//   - language?: ISO code ('es', 'en'...)
//   - prompt?: hint para mejorar transcripción (e.g. nombres propios)
// =====================================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { transcribeAudio } from '@/lib/audio/whisper';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_AUDIO_MB = 25;       // Whisper API tope: 25MB

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_form', detail: String(e) },
      { status: 400 }
    );
  }

  const audio = form.get('audio');
  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: 'audio_missing' }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_MB * 1024 * 1024) {
    return NextResponse.json(
      { error: 'audio_too_large', limit_mb: MAX_AUDIO_MB },
      { status: 413 }
    );
  }
  if (audio.size < 200) {
    return NextResponse.json(
      { error: 'audio_too_small', detail: 'parece grabación vacía' },
      { status: 400 }
    );
  }

  const language = (form.get('language') as string | null) || 'es';
  const prompt = (form.get('prompt') as string | null) || undefined;

  try {
    const result = await transcribeAudio(audio, { language, prompt });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: 'transcription_failed', detail: String(e) },
      { status: 500 }
    );
  }
}
