// =====================================================
// GET /api/metrics
// Devuelve métricas agregadas para el dashboard.
// Opcionales: ?granularity=day|week|month (default week), ?days=90
// =====================================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const granularity = (url.searchParams.get('granularity') as 'day' | 'week' | 'month') || 'week';
  const days = parseInt(url.searchParams.get('days') || '90', 10);

  // 1. Snapshot principal
  const { data: snapshotData, error: snapErr } = await supabase.rpc(
    'user_metrics_snapshot',
    { p_user_id: user.id }
  );
  if (snapErr) {
    return NextResponse.json(
      { error: 'metrics_failed', detail: snapErr.message },
      { status: 500 }
    );
  }

  // 2. Activity buckets
  const fromDate = new Date(Date.now() - days * 86400_000).toISOString();
  const { data: buckets } = await supabase.rpc('user_activity_buckets', {
    p_user_id: user.id,
    p_granularity: granularity,
    p_from: fromDate,
  });

  // 3. Top proyectos por interacción reciente (últimos 60d)
  const recentCutoff = new Date(Date.now() - 60 * 86400_000).toISOString();
  const { data: recentMems } = await supabase
    .from('memories')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .gte('captured_at', recentCutoff);

  const recentMemIds = (recentMems ?? []).map((m) => m.id);

  let topProjects: Array<{ id: string; name: string; slug: string; count: number; status: string }> = [];
  if (recentMemIds.length) {
    const { data: pLinks } = await supabase
      .from('memory_projects')
      .select('project_id, projects(id, name, slug, status)')
      .in('memory_id', recentMemIds);

    const map = new Map<string, { id: string; name: string; slug: string; count: number; status: string }>();
    for (const l of pLinks ?? []) {
      const p: any = (l as any).projects;
      if (!p) continue;
      const prev = map.get(p.id);
      if (prev) prev.count++;
      else map.set(p.id, { id: p.id, name: p.name, slug: p.slug, status: p.status, count: 1 });
    }
    topProjects = Array.from(map.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }

  // 4. Top entidades por interacción (usando interaction_count del Sprint 6)
  const { data: topEntities } = await supabase
    .from('entities')
    .select('id, name, entity_type, interaction_count')
    .eq('user_id', user.id)
    .gt('interaction_count', 0)
    .order('interaction_count', { ascending: false })
    .limit(8);

  return NextResponse.json({
    granularity,
    days_window: days,
    snapshot: snapshotData,
    activity: buckets ?? [],
    top_projects: topProjects,
    top_entities: topEntities ?? [],
  });
}
