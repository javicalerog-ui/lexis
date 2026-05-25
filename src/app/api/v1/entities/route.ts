// =====================================================
// API v1 · entities · GET (read scope)
// =====================================================

import { NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-v1/auth';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const auth = await authenticateApiRequest(req, 'read');
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const entityType = url.searchParams.get('type');
  const minInteractions = parseInt(url.searchParams.get('min_interactions') ?? '0');

  let q = auth.supabase
    .from('entities')
    .select(
      'id, name, entity_type, aliases, attributes, key_facts, rolling_summary, interaction_count, last_seen_at, created_at'
    )
    .eq('user_id', auth.user_id)
    .order('interaction_count', { ascending: false })
    .order('last_seen_at', { ascending: false, nullsFirst: false });

  if (entityType) q = q.eq('entity_type', entityType);
  if (minInteractions > 0) q = q.gte('interaction_count', minInteractions);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    items: data ?? [],
    count: data?.length ?? 0,
  });
}
