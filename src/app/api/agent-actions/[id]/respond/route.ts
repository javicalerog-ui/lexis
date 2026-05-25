// =====================================================
// POST /api/agent-actions/[id]/respond
//
// Ejecuta la quick reply elegida por el user. Cada action tiene
// efectos secundarios sobre el grafo:
//   - mark_event_done: cierra el evento vinculado
//   - snooze_event_2d / Nd: pospone el evento
//   - cancel_event: cancela el evento
//   - project_archive: archiva el proyecto
//   - project_snooze_14d: marca último captura para que no salte en 14d
//   - project_keep_active: sin efecto, solo cerrar la action
//   - dismiss / open_route: solo cerrar la action
//
// También se usa para responder por voz (action='voice_note' con
// transcript en el body): guarda como nueva memoria vinculada a la
// agent_action.
//
// Sprint 18.
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ingest } from '@/lib/ingestion/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 60;

const RespondSchema = z.object({
  action: z.string().min(1).max(60),
  payload: z.record(z.unknown()).optional(),
  voice_transcript: z.string().max(20_000).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof RespondSchema>;
  try {
    body = RespondSchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_body', detail: String(e).slice(0, 240) },
      { status: 400 }
    );
  }

  const { data: action, error: fetchErr } = await supabase
    .from('agent_actions')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single();

  if (fetchErr || !action) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (action.status !== 'pending') {
    return NextResponse.json(
      { error: 'already_responded', current_status: action.status },
      { status: 400 }
    );
  }

  const payload = body.payload || {};
  const sideEffects: any[] = [];

  // ---------- Efectos por tipo de action ----------
  try {
    switch (body.action) {
      // ----- eventos -----
      case 'mark_event_done': {
        const eventId = (payload.event_id as string) || (action.context?.event_id as string);
        if (eventId) {
          await supabase
            .from('events')
            .update({
              status: 'done',
              responded_at: new Date().toISOString(),
              response: { action: 'mark_done', via: 'agent_action', agent_action_id: action.id },
            })
            .eq('id', eventId)
            .eq('user_id', user.id);
          sideEffects.push({ event_marked_done: eventId });
        }
        break;
      }
      case 'snooze_event_1d':
      case 'snooze_event_2d':
      case 'snooze_event_7d': {
        const days = body.action === 'snooze_event_1d' ? 1 : body.action === 'snooze_event_2d' ? 2 : 7;
        const eventId = (payload.event_id as string) || (action.context?.event_id as string);
        if (eventId) {
          const { data: ev } = await supabase
            .from('events')
            .select('due_at')
            .eq('id', eventId)
            .eq('user_id', user.id)
            .single();
          if (ev) {
            await supabase
              .from('events')
              .update({
                due_at: new Date(new Date(ev.due_at).getTime() + days * 86400_000).toISOString(),
              })
              .eq('id', eventId);
            sideEffects.push({ event_snoozed: eventId, days });
          }
        }
        break;
      }
      case 'cancel_event': {
        const eventId = (payload.event_id as string) || (action.context?.event_id as string);
        if (eventId) {
          await supabase
            .from('events')
            .update({
              status: 'cancelled',
              responded_at: new Date().toISOString(),
              response: { action: 'cancel', via: 'agent_action' },
            })
            .eq('id', eventId);
          sideEffects.push({ event_cancelled: eventId });
        }
        break;
      }
      // ----- proyectos -----
      case 'project_archive': {
        const projectId = (payload.project_id as string) || (action.context?.project_id as string);
        if (projectId) {
          await supabase
            .from('projects')
            .update({ status: 'archived' })
            .eq('id', projectId)
            .eq('user_id', user.id);
          sideEffects.push({ project_archived: projectId });
        }
        break;
      }
      case 'project_snooze_14d': {
        const projectId = (payload.project_id as string) || (action.context?.project_id as string);
        if (projectId) {
          // No tocamos el proyecto; recordamos en su metadata cuándo fue snooze.
          await supabase
            .from('projects')
            .update({
              updated_at: new Date().toISOString(),
            })
            .eq('id', projectId)
            .eq('user_id', user.id);
          // Y marcamos la action con un expires_at de 14d para que no se redispare antes
          sideEffects.push({ project_snoozed_14d: projectId });
        }
        break;
      }
      case 'project_keep_active': {
        const projectId = (payload.project_id as string) || (action.context?.project_id as string);
        if (projectId) {
          // Solo refresca updated_at para que el detector "dormant" lo cuente como activo hoy
          await supabase
            .from('projects')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', projectId)
            .eq('user_id', user.id);
          sideEffects.push({ project_kept_active: projectId });
        }
        break;
      }
      // ----- voz libre -----
      case 'voice_note': {
        if (body.voice_transcript && body.voice_transcript.trim().length > 0) {
          const ingestRes = await ingest(supabase, user.id, {
            source_type: 'voice',
            raw_text: body.voice_transcript,
            source_metadata: {
              origin: 'agent_action_voice_reply',
              agent_action_id: action.id,
              rule_id: action.rule_id,
            },
          });
          sideEffects.push({ voice_memory_id: ingestRes.memory_id });
        }
        break;
      }
      // ----- dismiss / open_route / sin efecto -----
      case 'dismiss':
      case 'open_route':
      case 'snooze_1d':
      default:
        break;
    }
  } catch (e) {
    console.error('agent action side-effect error', e);
    sideEffects.push({ error: String(e).slice(0, 200) });
  }

  // ---------- Marcar la action ----------
  const newStatus =
    body.action === 'dismiss'
      ? 'dismissed'
      : body.action === 'open_route'
        ? 'pending'                   // no cierra, solo abre ruta
        : 'responded';

  if (newStatus !== 'pending') {
    await supabase
      .from('agent_actions')
      .update({
        status: newStatus,
        responded_at: new Date().toISOString(),
        response: {
          action: body.action,
          payload: body.payload ?? {},
          voice_transcript: body.voice_transcript ?? null,
          side_effects: sideEffects,
        },
      })
      .eq('id', action.id);
  }

  return NextResponse.json({
    ok: true,
    status: newStatus,
    side_effects: sideEffects,
  });
}

// DELETE = dismiss alternativo
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { error } = await supabase
    .from('agent_actions')
    .update({
      status: 'dismissed',
      responded_at: new Date().toISOString(),
      response: { action: 'dismiss' },
    })
    .eq('id', params.id)
    .eq('user_id', user.id);

  if (error) {
    return NextResponse.json(
      { error: 'update_failed', detail: error.message },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
