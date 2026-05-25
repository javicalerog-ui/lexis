// =====================================================
// GET    /api/connectors/[id]  — detalle
// PATCH  /api/connectors/[id]  — actualizar (name, schedule, config, enabled)
// DELETE /api/connectors/[id]  — borrar
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getAdapter } from '@/lib/connectors/registry';
import { isValidSchedule } from '@/lib/connectors/scheduler';
import { generateWebhookSecret } from '@/lib/connectors/webhook-secret';

export const runtime = 'nodejs';

interface RouteParams {
  params: { id: string };
}

export async function GET(_req: Request, { params }: RouteParams) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('connectors')
    .select(
      'id, type, name, enabled, schedule, config, credentials_id, webhook_secret_prefix, last_run_at, last_run_status, last_error, last_state, created_at, updated_at'
    )
    .eq('id', params.id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({ connector: data });
}

const PatchSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  enabled: z.boolean().optional(),
  schedule: z.string().nullable().optional(),
  config: z.record(z.unknown()).optional(),
  credentials_id: z.string().uuid().nullable().optional(),
  rotate_webhook_secret: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: RouteParams) {
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
      { error: 'invalid_body', detail: String(e) },
      { status: 400 }
    );
  }

  // Cargar para validar config con el adapter correcto
  const { data: existing } = await supabase
    .from('connectors')
    .select('id, type, webhook_secret_hash')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const adapter = getAdapter(existing.type);
  if (body.config && adapter?.validate_config) {
    const v = adapter.validate_config(body.config);
    if (!v.ok) {
      return NextResponse.json(
        { error: 'invalid_config', detail: v.error },
        { status: 400 }
      );
    }
  }

  if (body.schedule !== undefined && !isValidSchedule(body.schedule)) {
    return NextResponse.json(
      { error: 'invalid_schedule' },
      { status: 400 }
    );
  }

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (body.name !== undefined) update.name = body.name;
  if (body.enabled !== undefined) update.enabled = body.enabled;
  if (body.schedule !== undefined) update.schedule = body.schedule;
  if (body.config !== undefined) update.config = body.config;
  if (body.credentials_id !== undefined) update.credentials_id = body.credentials_id;

  let webhookPlain: string | null = null;
  if (body.rotate_webhook_secret && existing.webhook_secret_hash) {
    const ws = generateWebhookSecret();
    update.webhook_secret_hash = ws.hash;
    update.webhook_secret_prefix = ws.prefix;
    webhookPlain = ws.plain;
  }

  const { data, error } = await supabase
    .from('connectors')
    .update(update)
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: 'update_failed', detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    connector: data,
    webhook_secret: webhookPlain,
    warning_webhook: webhookPlain
      ? 'Nuevo webhook secret. El anterior ya no funciona. Guarda este ahora.'
      : undefined,
  });
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { error } = await supabase
    .from('connectors')
    .delete()
    .eq('id', params.id)
    .eq('user_id', user.id);

  if (error) {
    return NextResponse.json(
      { error: 'delete_failed', detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ deleted: true });
}
