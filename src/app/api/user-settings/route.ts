// =====================================================
// GET /api/user-settings
//   Devuelve user_settings actuales (creando defaults si no existían).
//
// PATCH /api/user-settings
//   Actualiza campos individuales. Valida formato HH:MM y rangos.
//
// Sprint 16 (también lo usan 17/18 para timezone y quiet hours).
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { loadUserSettings } from '@/lib/time/userTime';

export const runtime = 'nodejs';

const HmRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

const PatchSchema = z.object({
  timezone: z.string().min(1).max(80).optional(),
  preferred_language: z.string().min(2).max(8).optional(),
  quiet_hours_enabled: z.boolean().optional(),
  quiet_hours_start: z.string().regex(HmRegex).optional(),
  quiet_hours_end: z.string().regex(HmRegex).optional(),
  push_enabled: z.boolean().optional(),
  push_types_enabled: z.record(z.boolean()).optional(),
  push_offsets_minutes: z.array(z.number().int().min(0).max(43200)).max(8).optional(),
  write_to_primary: z.boolean().optional(),
});

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const settings = await loadUserSettings(supabase, user.id, { createIfMissing: true });
  return NextResponse.json({ settings });
}

export async function PATCH(req: Request) {
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

  // Garantizar que existe la row
  await loadUserSettings(supabase, user.id, { createIfMissing: true });

  const { data, error } = await supabase
    .from('user_settings')
    .update(body)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: 'db_error', detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ settings: data });
}
