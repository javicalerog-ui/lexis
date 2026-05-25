// =====================================================
// POST /api/push/subscribe
//   Registra una PushSubscription generada por el browser.
//   Idempotente: si ya existe (mismo endpoint), actualiza keys/UA.
//
// DELETE /api/push/subscribe
//   Elimina la suscripción del endpoint indicado.
//
// Sprint 16.
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const SubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  user_agent: z.string().max(500).optional(),
  label: z.string().max(120).optional(),
});

const UnsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof SubscribeSchema>;
  try {
    body = SubscribeSchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_body', detail: String(e).slice(0, 240) },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        user_id: user.id,
        endpoint: body.endpoint,
        keys: body.keys,
        user_agent: body.user_agent ?? null,
        label: body.label ?? null,
        last_used_at: null,
        last_error: null,
        last_error_at: null,
      },
      { onConflict: 'user_id,endpoint' }
    )
    .select('id, endpoint, label, created_at')
    .single();

  if (error) {
    return NextResponse.json(
      { error: 'db_error', detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ subscription: data });
}

export async function DELETE(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof UnsubscribeSchema>;
  try {
    body = UnsubscribeSchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_body', detail: String(e).slice(0, 240) },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', user.id)
    .eq('endpoint', body.endpoint);

  if (error) {
    return NextResponse.json(
      { error: 'db_error', detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}

// GET lista las suscripciones del user (para /settings/notifications)
export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, user_agent, label, last_used_at, last_error, last_error_at, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: 'db_error', detail: error.message },
      { status: 500 }
    );
  }

  // Exponemos también la VAPID public key para que el cliente pueda suscribirse
  return NextResponse.json({
    subscriptions: data ?? [],
    vapid_public_key: process.env.VAPID_PUBLIC_KEY ?? null,
  });
}
