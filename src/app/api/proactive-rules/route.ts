// =====================================================
// GET /api/proactive-rules
//   Lista todas las reglas del user. Crea presets lazy si faltan.
//
// POST /api/proactive-rules
//   Crea una regla custom (o, si ?force=true, ignora el detector
//   de conflictos). Si no se pasa force y el LLM detecta conflicto,
//   devuelve 409 con conflicting_rule_id + explanation para que la
//   UI muestre la pantalla de decisión.
//
// Sprint 17.
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import {
  ensurePresetsForUser,
  detectConflicts,
} from '@/lib/proactive/manage';
import { loadUserSettings, nextCronFireUtc } from '@/lib/time/userTime';

export const runtime = 'nodejs';

const CronRegex = /^(\S+\s+){4}\S+$/;

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(400).optional(),
  trigger_type: z.enum(['cron', 'event']),
  trigger_config: z.record(z.unknown()),
  action_type: z.string().min(1).max(60).default('push_simple'),
  action_payload: z.record(z.unknown()).default({}),
});

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  await ensurePresetsForUser(supabase, user.id);

  const { data, error } = await supabase
    .from('proactive_rules')
    .select('*')
    .eq('user_id', user.id)
    .order('kind', { ascending: true })           // presets primero
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: 'db_error', detail: error.message },
      { status: 500 }
    );
  }
  return NextResponse.json({ rules: data ?? [] });
}

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get('force') === 'true';
  const disablePresetId = url.searchParams.get('disable_preset_id');     // si el user elige "quedarme con la mía"

  let body: z.infer<typeof CreateSchema>;
  try {
    body = CreateSchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_body', detail: String(e).slice(0, 240) },
      { status: 400 }
    );
  }

  // Validar trigger_config según tipo
  if (body.trigger_type === 'cron') {
    const cron = body.trigger_config.cron as string | undefined;
    if (!cron || !CronRegex.test(cron)) {
      return NextResponse.json(
        { error: 'invalid_trigger', detail: 'Para trigger_type=cron, trigger_config.cron debe ser una expresión de 5 campos.' },
        { status: 400 }
      );
    }
  }

  const settings = await loadUserSettings(supabase, user.id, { createIfMissing: true });
  const tz = settings.timezone;

  // ---------- Detector de conflictos ----------
  if (!force) {
    const { data: existing } = await supabase
      .from('proactive_rules')
      .select('id, name, description, trigger_type, trigger_config, action_type, enabled, kind')
      .eq('user_id', user.id);

    const conflict = await detectConflicts({
      new_rule: {
        name: body.name,
        description: body.description ?? '',
        trigger_type: body.trigger_type,
        trigger_config: body.trigger_config,
        action_type: body.action_type,
      },
      existing_rules: (existing ?? []) as any[],
    });

    if (conflict.has_conflict && conflict.confidence >= 0.6) {
      const { data: conflictRule } = await supabase
        .from('proactive_rules')
        .select('*')
        .eq('id', conflict.conflicting_rule_id!)
        .single();

      return NextResponse.json(
        {
          error: 'conflict_detected',
          conflict: {
            kind: conflict.conflict_kind,
            explanation: conflict.explanation,
            confidence: conflict.confidence,
            conflicting_rule: conflictRule,
            new_rule_draft: body,
          },
        },
        { status: 409 }
      );
    }
  }

  // ---------- Si el user vino con disable_preset_id (eligió "quedarme con la mía") ----------
  if (disablePresetId) {
    await supabase
      .from('proactive_rules')
      .update({ enabled: false })
      .eq('id', disablePresetId)
      .eq('user_id', user.id);
  }

  // ---------- Calcular next_due_at ----------
  let nextDueAt: string | null = null;
  if (body.trigger_type === 'cron') {
    const nxt = nextCronFireUtc(body.trigger_config.cron as string, tz);
    nextDueAt = nxt ? nxt.toISOString() : null;
  }

  const { data, error } = await supabase
    .from('proactive_rules')
    .insert({
      user_id: user.id,
      kind: 'custom',
      preset_key: null,
      name: body.name,
      description: body.description ?? null,
      trigger_type: body.trigger_type,
      trigger_config: body.trigger_config,
      action_type: body.action_type,
      action_payload: body.action_payload,
      enabled: true,
      timezone: tz,
      next_due_at: nextDueAt,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: 'db_error', detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ rule: data });
}
