// =====================================================
// DELETE /api/credentials/[id] — borra una credential
//
// Los connectors que la usen pasarán a credentials_id=null
// (ON DELETE SET NULL). El usuario tendrá que re-autenticar.
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

  const { error } = await supabase
    .from('connector_credentials')
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
