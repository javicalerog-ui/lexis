// =====================================================
// API v1 · answer — síntesis RAG vía PAT (scope read).
//
// POST /api/v1/answer { query, memory_ids? }
// Mismo motor que /api/answer. Pensado para integraciones
// (Claude Code, Acta, scripts) que quieren una RESPUESTA
// redactada y con procedencia, no solo la lista de memorias.
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateApiRequest } from '@/lib/api-v1/auth';
import { synthesizeAnswer } from '@/lib/answer/synthesize';

export const runtime = 'nodejs';
export const maxDuration = 90;

const Schema = z.object({
  query: z.string().min(1).max(2000),
  memory_ids: z.array(z.string().uuid()).max(12).optional(),
});

export async function POST(req: Request) {
  const auth = await authenticateApiRequest(req, 'read');
  if (auth instanceof NextResponse) return auth;

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
    const result = await synthesizeAnswer(auth.supabase, auth.user_id, body.query, {
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
