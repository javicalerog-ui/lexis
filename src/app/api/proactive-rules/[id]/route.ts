// =====================================================
// PATCH /api/proactive-rules/[id]
//   Actualiza enabled / name / description / payload.
//   Presets se pueden deshabilitar pero no borrar (DELETE devuelve 403).
//
// DELETE /api/proactive-rules/[id]
//   Solo permitido para kind='custom'.
//
// Sprint 17.
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { nextCronFireUtc, loadUserSettings } from '@/lib/time/userTime';

export const runtime = 'nodejs';

const PatchSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(400).nullable().optional(),
  trigger_config: z.record(z.unknown()).optional(),
  action_payload: z.record(z.unknown()).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
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

  // Si modificó trigger_config y es cron, recalcular next_due_at
  let nextDueAtUpdate: Record<string, unknown> = {};
  if (body.trigger_config?.cron) {
    const settings = await loadUserSettings(supabase, user.id);
    const nxt = nextCronFireUtc(body.trigger_config.cron as string, settings.timezone);
    nextDueAtUpdate.next_due_at = nxt ? nxt.toISOString() : null;
  }

  const { data, error } = await supabase
    .from('proactive_rules')
    .update({ ...body, ...nextDueAtUpdate })
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
  return NextResponse.json({ rule: data });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data: rule } = await supabase
    .from('proactive_rules')
    .select('kind')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single();

  if (!rule) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (rule.kind === 'preset') {
    return NextResponse.json(
      {
        error: 'preset_cannot_delete',
        detail: 'Las reglas preset se pueden deshabilitar pero no borrar.',
      },
      { status: 403 }
    );
  }

  const { error } = await supabase
    .from('proactive_rules')
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
