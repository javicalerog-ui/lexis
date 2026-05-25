// =====================================================
// GET  /api/connectors  — lista connectors del user con stats
// POST /api/connectors  — crea uno nuevo
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getAdapter, listAdapters, publicAdapterInfo } from '@/lib/connectors/registry';
import { isValidSchedule } from '@/lib/connectors/scheduler';
import { generateWebhookSecret } from '@/lib/connectors/webhook-secret';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const includeAdapters = url.searchParams.get('include_adapters') === '1';

  const { data: connectors, error } = await supabase.rpc(
    'list_connectors_with_stats',
    { p_user_id: user.id }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const body: Record<string, unknown> = { connectors: connectors ?? [] };
  if (includeAdapters) {
    body.available_adapters = listAdapters().map(publicAdapterInfo);
  }
  return NextResponse.json(body);
}

const CreateSchema = z.object({
  type: z.string().min(1).max(40),
  name: z.string().min(2).max(80),
  schedule: z.string().nullable().optional(),
  config: z.record(z.unknown()).optional(),
  credentials_id: z.string().uuid().nullable().optional(),
  enable_webhook: z.boolean().optional(),
});

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof CreateSchema>;
  try {
    body = CreateSchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_body', detail: String(e) },
      { status: 400 }
    );
  }

  const adapter = getAdapter(body.type);
  if (!adapter) {
    return NextResponse.json(
      { error: 'unknown_type', detail: `No existe adapter para "${body.type}"` },
      { status: 400 }
    );
  }

  // Validar config con el adapter
  if (adapter.validate_config) {
    const v = adapter.validate_config(body.config ?? {});
    if (!v.ok) {
      return NextResponse.json(
        { error: 'invalid_config', detail: v.error },
        { status: 400 }
      );
    }
  }

  // Validar schedule
  if (!isValidSchedule(body.schedule)) {
    return NextResponse.json(
      { error: 'invalid_schedule', detail: 'Formato no válido. Ejemplos: "every:15m", "every:6h", "daily:7"' },
      { status: 400 }
    );
  }

  // Si el connector NO soporta schedule, fuerza schedule=null
  const schedule = adapter.supports_schedule ? body.schedule ?? null : null;

  // Webhook secret si procede
  let webhookHash: string | null = null;
  let webhookPrefix: string | null = null;
  let webhookPlain: string | null = null;
  const wantsWebhook =
    adapter.supports_webhook &&
    (body.enable_webhook ?? adapter.type === 'webhook');
  if (wantsWebhook) {
    const ws = generateWebhookSecret();
    webhookHash = ws.hash;
    webhookPrefix = ws.prefix;
    webhookPlain = ws.plain;
  }

  const { data, error } = await supabase
    .from('connectors')
    .insert({
      user_id: user.id,
      type: body.type,
      name: body.name,
      schedule,
      config: body.config ?? {},
      credentials_id: body.credentials_id ?? null,
      webhook_secret_hash: webhookHash,
      webhook_secret_prefix: webhookPrefix,
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: 'persist_failed', detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      connector: data,
      webhook_secret: webhookPlain,
      warning_webhook: webhookPlain
        ? 'Guarda el webhook secret ahora. No podrás verlo de nuevo.'
        : undefined,
    },
    { status: 201 }
  );
}
