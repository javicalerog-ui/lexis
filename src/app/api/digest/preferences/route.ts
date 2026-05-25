// =====================================================
// GET  /api/digest/preferences  — lee preferencias
// PATCH /api/digest/preferences — actualiza (upsert)
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data } = await supabase
    .from('digest_preferences')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!data) {
    return NextResponse.json({
      user_id: user.id,
      enabled: true,
      cadence: 'weekly',
      send_hour_utc: 7,
      day_of_week: 1,
      day_of_month: 1,
      email: user.email,
      last_sent_at: null,
    });
  }

  return NextResponse.json({
    ...data,
    email: data.email || user.email,
  });
}

const Patch = z.object({
  enabled: z.boolean().optional(),
  cadence: z.enum(['weekly', 'biweekly', 'monthly']).optional(),
  send_hour_utc: z.number().int().min(0).max(23).optional(),
  day_of_week: z.number().int().min(0).max(6).optional(),
  day_of_month: z.number().int().min(1).max(28).optional(),
  email: z.string().email().nullable().optional(),
});

export async function PATCH(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof Patch>;
  try {
    body = Patch.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_body', detail: String(e) },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from('digest_preferences')
    .upsert(
      {
        user_id: user.id,
        ...body,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
