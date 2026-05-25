// =====================================================
// GET  /api/tokens — lista tokens del usuario (sin el plain text)
// POST /api/tokens — crea token nuevo y devuelve el plain UNA SOLA VEZ
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { generateToken } from '@/lib/api-v1/tokens';

export const runtime = 'nodejs';

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('personal_access_tokens')
    .select(
      'id, name, token_prefix, token_last_four, scopes, last_used_at, last_used_ip, last_used_user_agent, expires_at, revoked_at, created_at'
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ tokens: data ?? [] });
}

const CreateSchema = z.object({
  name: z.string().min(2).max(80),
  scopes: z.array(z.enum(['read', 'write'])).min(1).max(2),
  expires_at: z.string().datetime().nullable().optional(),
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

  const generated = generateToken();

  const { data, error } = await supabase
    .from('personal_access_tokens')
    .insert({
      user_id: user.id,
      name: body.name,
      token_hash: generated.hash,
      token_prefix: generated.prefix,
      token_last_four: generated.last_four,
      scopes: body.scopes,
      expires_at: body.expires_at ?? null,
    })
    .select(
      'id, name, token_prefix, token_last_four, scopes, expires_at, created_at'
    )
    .single();

  if (error) {
    return NextResponse.json(
      { error: 'persist_failed', detail: error.message },
      { status: 500 }
    );
  }

  // Devolvemos el plain UNA SOLA VEZ. El user es responsable de copiarlo.
  return NextResponse.json({
    token: data,
    plain_text: generated.plain,
    warning: 'Guarda este token ahora. No podrás verlo de nuevo.',
  });
}
