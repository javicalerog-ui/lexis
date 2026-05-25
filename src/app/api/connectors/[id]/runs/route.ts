// =====================================================
// GET /api/connectors/[id]/runs
// Lista las últimas N ejecuciones (paginada).
// =====================================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

interface RouteParams {
  params: { id: string };
}

export async function GET(req: Request, { params }: RouteParams) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

  // Confirmar ownership
  const { data: c } = await supabase
    .from('connectors')
    .select('id')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!c) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { data, error } = await supabase
    .from('connector_runs')
    .select(
      'id, status, trigger, started_at, completed_at, items_fetched, items_new, items_skipped, items_failed, error_message, payload'
    )
    .eq('connector_id', params.id)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ runs: data ?? [] });
}
