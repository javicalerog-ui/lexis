// =====================================================
// GET /api/agent-actions
//   Lista de acciones del user. Filtros: ?status=pending&limit=50
//
// Sprint 18.
// =====================================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const status = url.searchParams.get('status') as
    | 'pending' | 'responded' | 'dismissed' | 'expired' | null;
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 200);

  let q = supabase
    .from('agent_actions')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json(
      { error: 'db_error', detail: error.message },
      { status: 500 }
    );
  }

  // Marcar como expired las que tocan (mantenimiento ligero al consultar)
  const now = new Date().toISOString();
  const toExpire = (data ?? []).filter(
    (a) => a.status === 'pending' && a.expires_at && a.expires_at < now
  );
  if (toExpire.length > 0) {
    await supabase
      .from('agent_actions')
      .update({ status: 'expired' })
      .in('id', toExpire.map((a) => a.id));
  }

  // Count del badge
  const { count } = await supabase
    .from('agent_actions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('status', 'pending');

  return NextResponse.json({
    actions: data ?? [],
    pending_count: count ?? 0,
  });
}
