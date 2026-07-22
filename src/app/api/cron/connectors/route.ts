// =====================================================
// POST /api/cron/connectors
//
// Dispatcher cron: itera todos los connectors enabled con
// schedule no-null, evalúa shouldRunNow, y ejecuta los que tocan.
//
// Protegido por CRON_SECRET. Configurar en Cloudflare como
// Cron Trigger cada 5 o 10 minutos para granularidad razonable.
// =====================================================

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { shouldRunNow } from '@/lib/connectors/scheduler';
import { runConnector } from '@/lib/connectors/runner';
import { isCronRequestAuthorized } from '@/lib/security/cron-auth.mjs';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!isCronRequestAuthorized(req.headers)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();

  // Listar candidatos: enabled + schedule no-null
  const { data: candidates, error } = await supabase
    .from('connectors')
    .select('id, user_id, type, name, schedule, last_run_at')
    .eq('enabled', true)
    .not('schedule', 'is', null);

  if (error) {
    return NextResponse.json(
      { error: 'list_failed', detail: error.message },
      { status: 500 }
    );
  }

  const results: Array<Record<string, unknown>> = [];

  for (const c of candidates ?? []) {
    const decision = shouldRunNow(c.schedule, c.last_run_at, now);
    if (!decision.should_run) {
      results.push({
        connector_id: c.id,
        name: c.name,
        skipped: true,
        reason: decision.reason,
      });
      continue;
    }

    try {
      const summary = await runConnector(supabase, c.id, c.user_id, {
        trigger: 'cron',
      });
      results.push({
        connector_id: c.id,
        name: c.name,
        run: summary,
      });
    } catch (e) {
      results.push({
        connector_id: c.id,
        name: c.name,
        error: String(e),
      });
    }
  }

  return NextResponse.json({
    timestamp: now.toISOString(),
    total_candidates: candidates?.length ?? 0,
    executed: results.filter((r) => !r.skipped && !r.error).length,
    skipped: results.filter((r) => r.skipped).length,
    failed: results.filter((r) => r.error).length,
    results,
  });
}

// GET por conveniencia: estado actual sin ejecutar nada
export async function GET(req: Request) {
  if (!isCronRequestAuthorized(req.headers)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();

  const { data } = await supabase
    .from('connectors')
    .select('id, user_id, name, type, schedule, enabled, last_run_at, last_run_status')
    .eq('enabled', true)
    .not('schedule', 'is', null);

  const decisions = (data ?? []).map((c) => ({
    ...c,
    decision: shouldRunNow(c.schedule, c.last_run_at, now),
  }));

  return NextResponse.json({
    now: now.toISOString(),
    connectors: decisions,
  });
}
