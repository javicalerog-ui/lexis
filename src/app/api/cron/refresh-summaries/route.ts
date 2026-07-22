// =====================================================
// POST /api/cron/refresh-summaries
// Endpoint protegido por Authorization: Bearer <CRON_SECRET>.
// Refresca rolling_summary de:
//   - Proyectos activos con actividad reciente o summary stale
//   - Entidades marcadas summary_stale (Sprint 6)
//
// Triggers posibles:
//  - Cloudflare Worker con cron + fetch
//  - GitHub Actions schedule
//  - Manual curl
// =====================================================

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { refreshProjectSummary } from '@/lib/projects/refresh-summary';
import { refreshEntitySummary } from '@/lib/entities/refresh-summary';
import { isCronRequestAuthorized } from '@/lib/security/cron-auth.mjs';

export const runtime = 'nodejs';
export const maxDuration = 300;

const STALENESS_HOURS = 1;
const MAX_PROJECTS_PER_RUN = 30;
const MAX_ENTITIES_PER_RUN = 20;
// Entidades con muy pocas interacciones se refrescan con menos prioridad
const ENTITY_MIN_INTERACTIONS = 2;

export async function POST(req: Request) {
  if (!isCronRequestAuthorized(req.headers)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const cutoff = new Date(Date.now() - STALENESS_HOURS * 3600_000).toISOString();

  // ============ Proyectos ============
  const { data: projectCandidates } = await supabase
    .from('projects')
    .select('id, user_id, name, rolling_summary_updated_at, last_activity_at')
    .eq('status', 'active')
    .order('last_activity_at', { ascending: false, nullsFirst: false })
    .limit(MAX_PROJECTS_PER_RUN);

  const projectFiltered = (projectCandidates ?? []).filter((p) => {
    if (!p.rolling_summary_updated_at) return true;
    if (!p.last_activity_at) return false;
    return (
      p.last_activity_at > p.rolling_summary_updated_at ||
      p.rolling_summary_updated_at < cutoff
    );
  });

  const projectResults = [];
  for (const p of projectFiltered) {
    try {
      const r = await refreshProjectSummary(supabase, p.id);
      projectResults.push({ id: p.id, name: p.name, ...r });
    } catch (e) {
      projectResults.push({
        id: p.id,
        name: p.name,
        refreshed: false,
        reason: `error:${String(e).slice(0, 200)}`,
      });
    }
  }

  // ============ Entidades ============
  // Priorizar las que están stale y tienen >= ENTITY_MIN_INTERACTIONS.
  const { data: entityCandidates } = await supabase
    .from('entities')
    .select('id, user_id, name, interaction_count, last_seen_at')
    .eq('summary_stale', true)
    .gte('interaction_count', ENTITY_MIN_INTERACTIONS)
    .order('interaction_count', { ascending: false })
    .order('last_seen_at', { ascending: false, nullsFirst: false })
    .limit(MAX_ENTITIES_PER_RUN);

  const entityResults = [];
  for (const e of entityCandidates ?? []) {
    try {
      const r = await refreshEntitySummary(supabase, e.user_id, e.id);
      entityResults.push({
        id: e.id,
        name: e.name,
        interactions: e.interaction_count,
        refreshed: r !== null,
        confidence: r?.confidence ?? null,
      });
    } catch (err) {
      entityResults.push({
        id: e.id,
        name: e.name,
        refreshed: false,
        reason: `error:${String(err).slice(0, 200)}`,
      });
    }
  }

  return NextResponse.json({
    projects: {
      examined: projectCandidates?.length ?? 0,
      queued: projectFiltered.length,
      refreshed: projectResults.filter((r) => r.refreshed).length,
      results: projectResults,
    },
    entities: {
      examined: entityCandidates?.length ?? 0,
      refreshed: entityResults.filter((r) => r.refreshed).length,
      results: entityResults,
    },
  });
}
