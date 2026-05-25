// =====================================================
// API v1 · projects · GET (read scope)
// =====================================================

import { NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-v1/auth';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const auth = await authenticateApiRequest(req, 'read');
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const status = url.searchParams.get('status');

  let q = auth.supabase
    .from('projects')
    .select(
      'id, slug, name, description, status, rolling_summary, rolling_next_steps, last_activity_at, created_at'
    )
    .eq('user_id', auth.user_id)
    .order('last_activity_at', { ascending: false, nullsFirst: false });

  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    items: data ?? [],
    count: data?.length ?? 0,
  });
}
