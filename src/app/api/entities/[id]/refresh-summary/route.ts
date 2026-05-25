// =====================================================
// POST /api/entities/[id]/refresh-summary
// Regenera el rolling_summary de la entidad on-demand.
// =====================================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { refreshEntitySummary } from '@/lib/entities/refresh-summary';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface RouteParams {
  params: { id: string };
}

export async function POST(_req: Request, { params }: RouteParams) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await refreshEntitySummary(supabase, user.id, params.id);
    if (!result) {
      return NextResponse.json({
        entity_id: params.id,
        summary: null,
        reason: 'no_memories',
      });
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: 'refresh_failed', detail: String(e) },
      { status: 500 }
    );
  }
}
