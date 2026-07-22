// =====================================================
// POST /api/answer — capa de respuesta (síntesis RAG), sesión.
//
// Body: { query: string, memory_ids?: string[] }
// Si vienen memory_ids (el cliente ya buscó), se reutilizan esas
// memorias en ese orden; si no, la síntesis busca por su cuenta.
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { synthesizeAnswer } from '@/lib/answer/synthesize';

export const runtime = 'nodejs';
// 90s (como /api/feed): cubre embed + 2 intentos de OpenRouter dentro del límite
// del plan, sin que Vercel mate la función a mitad de reintento.
export const maxDuration = 90;

const Schema = z.object({
  query: z.string().min(1).max(2000),
  memory_ids: z.array(z.string().uuid()).max(12).optional(),
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
    const result = await synthesizeAnswer(supabase, user.id, body.query, {
      memoryIds: body.memory_ids,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: 'answer_failed', detail: String(e).slice(0, 400) },
      { status: 500 }
    );
  }
}
