// =====================================================
// DELETE /api/tokens/[id] — revoca un token (no lo borra)
// =====================================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

interface RouteParams {
  params: { id: string };
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('personal_access_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .select('id, name, revoked_at')
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: 'revoke_failed', detail: error.message },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: 'not_found_or_already_revoked' },
      { status: 404 }
    );
  }

  return NextResponse.json({
    revoked: true,
    token: data,
  });
}
