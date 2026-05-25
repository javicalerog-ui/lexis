// =====================================================
// POST /api/interview/[id]/complete
// Cierra una sesión activa:
//   1. Genera título de 1 línea.
//   2. Genera resumen estructurado (overview, highlights, connections,
//      proyectos/entidades nuevos detectados).
//   3. Persiste status='completed' + completed_at + summary.
// =====================================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  generateSessionTitle,
  generateSessionSummary,
} from '@/lib/interview/orchestrator';

export const runtime = 'nodejs';
export const maxDuration = 90;

interface RouteParams {
  params: { id: string };
}

export async function POST(_req: Request, { params }: RouteParams) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data: session } = await supabase
    .from('interview_sessions')
    .select('id, status, title, summary')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!session) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (session.status === 'completed') {
    return NextResponse.json({
      session_id: session.id,
      already_completed: true,
      title: session.title,
      summary: session.summary,
    });
  }

  const { data: messages } = await supabase
    .from('interview_messages')
    .select('role, content')
    .eq('session_id', session.id)
    .order('created_at', { ascending: true });

  // 1. Título de 1 línea (Fast tier, barato)
  let title: string | null = session.title;
  if (!title && messages?.length) {
    try {
      title = await generateSessionTitle(
        messages.map((m) => ({
          role: m.role as 'assistant' | 'user',
          content: m.content,
        }))
      );
    } catch (e) {
      console.error('title generation failed', e);
    }
  }

  // 2. Resumen estructurado (Deep tier, calidad)
  let summary = null;
  try {
    if ((messages?.length ?? 0) >= 2) {
      summary = await generateSessionSummary(supabase, user.id, session.id);
    }
  } catch (e) {
    console.error('session summary generation failed', e);
    // No bloqueamos el cierre por fallo en el summary; queda null.
  }

  await supabase
    .from('interview_sessions')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      title,
      summary,
    })
    .eq('id', session.id);

  return NextResponse.json({
    session_id: session.id,
    title,
    summary,
    completed_at: new Date().toISOString(),
  });
}
