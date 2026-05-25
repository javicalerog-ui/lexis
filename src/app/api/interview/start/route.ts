// =====================================================
// POST /api/interview/start
// Crea una nueva sesión de entrevista y devuelve la primera pregunta.
// Body: { focus_type: 'open'|'project'|'entity', focus_id?: string }
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { openingQuestion } from '@/lib/interview/orchestrator';

export const runtime = 'nodejs';
export const maxDuration = 60;

const Schema = z.object({
  focus_type: z.enum(['open', 'project', 'entity']).default('open'),
  focus_id: z.string().uuid().optional(),
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

  // Validar focus_id si aplica
  let focus_name: string | undefined;
  if (body.focus_type === 'project' && body.focus_id) {
    const { data } = await supabase
      .from('projects')
      .select('name')
      .eq('id', body.focus_id)
      .maybeSingle();
    if (!data) {
      return NextResponse.json(
        { error: 'project_not_found' },
        { status: 404 }
      );
    }
    focus_name = data.name;
  }
  if (body.focus_type === 'entity' && body.focus_id) {
    const { data } = await supabase
      .from('entities')
      .select('name')
      .eq('id', body.focus_id)
      .maybeSingle();
    if (!data) {
      return NextResponse.json(
        { error: 'entity_not_found' },
        { status: 404 }
      );
    }
    focus_name = data.name;
  }

  // Crear sesión
  const { data: session, error: sErr } = await supabase
    .from('interview_sessions')
    .insert({
      user_id: user.id,
      status: 'active',
      focus_type: body.focus_type,
      focus_project_id:
        body.focus_type === 'project' ? body.focus_id ?? null : null,
      focus_entity_id:
        body.focus_type === 'entity' ? body.focus_id ?? null : null,
    })
    .select('id, created_at')
    .single();

  if (sErr || !session) {
    return NextResponse.json(
      { error: 'session_create_failed', detail: sErr?.message },
      { status: 500 }
    );
  }

  // Generar primera pregunta
  try {
    const opening = await openingQuestion(supabase, user.id, {
      focus_type: body.focus_type,
      focus_id: body.focus_id ?? null,
      focus_name,
    });

    // Persistir el primer mensaje del asistente
    await supabase.from('interview_messages').insert({
      session_id: session.id,
      role: 'assistant',
      content: opening.question,
    });

    await supabase
      .from('interview_sessions')
      .update({
        questions_asked: 1,
        last_message_at: new Date().toISOString(),
      })
      .eq('id', session.id);

    return NextResponse.json({
      session_id: session.id,
      first_question: opening.question,
      focus_type: body.focus_type,
      focus_id: body.focus_id ?? null,
      focus_name,
    });
  } catch (e) {
    // Si falla la generación, dejamos la sesión vacía para que el user pueda reintentar
    return NextResponse.json(
      { error: 'opening_failed', detail: String(e), session_id: session.id },
      { status: 500 }
    );
  }
}
