// =====================================================
// GET  /api/interview/[id]  — devuelve sesión + mensajes
// POST /api/interview/[id]  — envía respuesta del usuario,
//                             genera memoria + siguiente pregunta
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import {
  ingestUserResponse,
  nextQuestion,
  type FocusType,
} from '@/lib/interview/orchestrator';

export const runtime = 'nodejs';
export const maxDuration = 90;

interface RouteParams {
  params: { id: string };
}

async function loadSession(supabase: any, userId: string, sessionId: string) {
  const { data: session } = await supabase
    .from('interview_sessions')
    .select(
      'id, status, focus_type, focus_project_id, focus_entity_id, questions_asked, memories_generated, saturation_signal, title, summary, created_at, last_message_at, completed_at'
    )
    .eq('id', sessionId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!session) return null;

  // Cargar nombre del foco si aplica
  let focus_name: string | undefined;
  if (session.focus_type === 'project' && session.focus_project_id) {
    const { data: p } = await supabase
      .from('projects')
      .select('name, slug')
      .eq('id', session.focus_project_id)
      .maybeSingle();
    focus_name = p?.name;
    (session as any).focus_slug = p?.slug;
  } else if (session.focus_type === 'entity' && session.focus_entity_id) {
    const { data: e } = await supabase
      .from('entities')
      .select('name')
      .eq('id', session.focus_entity_id)
      .maybeSingle();
    focus_name = e?.name;
  }
  (session as any).focus_name = focus_name;

  return session;
}

async function loadMessages(supabase: any, sessionId: string) {
  const { data: messages } = await supabase
    .from('interview_messages')
    .select('id, role, content, memory_id, topic_shift, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  return messages ?? [];
}

export async function GET(_req: Request, { params }: RouteParams) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const session = await loadSession(supabase, user.id, params.id);
  if (!session) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const messages = await loadMessages(supabase, session.id);

  return NextResponse.json({ session, messages });
}

const PostSchema = z.object({
  message: z.string().min(1).max(8000),
});

export async function POST(req: Request, { params }: RouteParams) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof PostSchema>;
  try {
    body = PostSchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_body', detail: String(e) },
      { status: 400 }
    );
  }

  const session = await loadSession(supabase, user.id, params.id);
  if (!session) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (session.status !== 'active') {
    return NextResponse.json(
      { error: 'session_not_active', status: session.status },
      { status: 400 }
    );
  }

  const messages = await loadMessages(supabase, session.id);
  if (!messages.length) {
    return NextResponse.json(
      { error: 'no_opening_question' },
      { status: 400 }
    );
  }

  // La pregunta a la que está respondiendo es el último mensaje del assistant
  const lastAssistant = [...messages]
    .reverse()
    .find((m: any) => m.role === 'assistant');

  // 1. Persistir el turno del usuario
  const { data: userMsg, error: userMsgErr } = await supabase
    .from('interview_messages')
    .insert({
      session_id: session.id,
      role: 'user',
      content: body.message,
    })
    .select('id')
    .single();

  if (userMsgErr) {
    return NextResponse.json(
      { error: 'insert_user_msg_failed', detail: userMsgErr.message },
      { status: 500 }
    );
  }

  // 2. Ingestar la respuesta como memoria
  const focus = {
    focus_type: session.focus_type as FocusType,
    focus_id: (session.focus_type === 'project'
      ? session.focus_project_id
      : session.focus_type === 'entity'
      ? session.focus_entity_id
      : null) as string | null,
    focus_name: (session as any).focus_name as string | undefined,
  };

  let memoryId: string | null = null;
  let memorySummary: string | null = null;
  try {
    const ingested = await ingestUserResponse(
      supabase,
      user.id,
      session.id,
      lastAssistant?.content ?? '(sin pregunta previa)',
      body.message,
      focus
    );
    memoryId = ingested.memory_id;
    memorySummary = ingested.summary;

    if (memoryId) {
      await supabase
        .from('interview_messages')
        .update({ memory_id: memoryId })
        .eq('id', userMsg.id);
    }
  } catch (e) {
    console.error('ingest interview response failed', e);
  }

  // 3. Generar siguiente pregunta
  const history = messages
    .filter((m: any) => m.role === 'assistant' || m.role === 'user')
    .map((m: any) => ({
      role: m.role as 'assistant' | 'user',
      content: m.content as string,
    }));
  history.push({ role: 'user', content: body.message });

  try {
    const next = await nextQuestion(supabase, user.id, focus, history);

    // Persistir nueva pregunta del assistant (si no está saturado)
    let newAssistantMsg = null;
    if (!next.saturated) {
      const { data } = await supabase
        .from('interview_messages')
        .insert({
          session_id: session.id,
          role: 'assistant',
          content: next.next_question,
          reasoning: next.reasoning,
          topic_shift: next.topic_shift,
        })
        .select('id, content, topic_shift, created_at')
        .single();
      newAssistantMsg = data;
    }

    // Actualizar contadores de la sesión
    await supabase
      .from('interview_sessions')
      .update({
        questions_asked: (session.questions_asked ?? 0) + (next.saturated ? 0 : 1),
        memories_generated:
          (session.memories_generated ?? 0) + (memoryId ? 1 : 0),
        saturation_signal: next.confidence,
        last_message_at: new Date().toISOString(),
      })
      .eq('id', session.id);

    return NextResponse.json({
      user_message_id: userMsg.id,
      memory_id: memoryId,
      memory_summary: memorySummary,
      next_question: next.saturated ? null : next.next_question,
      assistant_message: newAssistantMsg,
      topic_shift: next.topic_shift,
      saturated: next.saturated,
      confidence: next.confidence,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: 'next_question_failed',
        detail: String(e),
        memory_id: memoryId,
      },
      { status: 500 }
    );
  }
}
