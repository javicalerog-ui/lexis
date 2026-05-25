// =====================================================
// PATCH /api/events/[id]
//
// Actualiza status de un evento. Operaciones soportadas:
//   - mark_done: cierra el evento (status='done', responded_at=now)
//   - snooze: pospone N días (mueve due_at, status='pending')
//   - cancel: descarta (status='cancelled')
//   - reopen: status='done'/'cancelled' → 'pending'
//
// También se usa para edición manual del título/descripción.
//
// Sprint 15.
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const PatchSchema = z.object({
  action: z.enum(['mark_done', 'snooze', 'cancel', 'reopen', 'edit']).optional(),
  snooze_days: z.number().int().min(1).max(365).optional(),
  title: z.string().min(1).max(240).optional(),
  description: z.string().max(2000).nullable().optional(),
  due_at: z.string().datetime().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof PatchSchema>;
  try {
    body = PatchSchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_body', detail: String(e).slice(0, 240) },
      { status: 400 }
    );
  }

  const { data: current, error: fetchErr } = await supabase
    .from('events')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single();

  if (fetchErr || !current) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const update: Record<string, any> = {};

  switch (body.action) {
    case 'mark_done':
      update.status = 'done';
      update.responded_at = new Date().toISOString();
      update.response = { action: 'mark_done' };
      break;
    case 'snooze':
      const days = body.snooze_days ?? 2;
      const newDueAt = new Date(
        new Date(current.due_at).getTime() + days * 86400_000
      ).toISOString();
      update.due_at = newDueAt;
      update.status = 'pending';
      update.metadata = {
        ...(current.metadata || {}),
        snoozed_history: [
          ...((current.metadata?.snoozed_history as any[]) || []),
          { at: new Date().toISOString(), days, prev_due_at: current.due_at },
        ],
      };
      break;
    case 'cancel':
      update.status = 'cancelled';
      update.responded_at = new Date().toISOString();
      update.response = { action: 'cancel' };
      break;
    case 'reopen':
      update.status = 'pending';
      update.responded_at = null;
      update.response = null;
      break;
    case 'edit':
    default:
      // Edición campo a campo
      if (body.title !== undefined) update.title = body.title;
      if (body.description !== undefined) update.description = body.description;
      if (body.due_at !== undefined) update.due_at = body.due_at;
      break;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: 'no_changes', detail: 'Acción no válida o sin campos a actualizar' },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from('events')
    .update(update)
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: 'update_failed', detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ event: data });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { error } = await supabase
    .from('events')
    .delete()
    .eq('id', params.id)
    .eq('user_id', user.id);

  if (error) {
    return NextResponse.json(
      { error: 'delete_failed', detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
