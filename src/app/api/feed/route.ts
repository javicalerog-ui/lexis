// =====================================================
// GET /api/feed
// Sintetiza el feed proactivo a partir de los proyectos
// activos del usuario. Usa cache (TTL 1h por defecto).
// Forzar regenerar con ?refresh=1.
// =====================================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOrBuildFeed } from '@/lib/projects/feed-cache';

export const runtime = 'nodejs';
export const maxDuration = 90;

export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const forceRefresh = url.searchParams.get('refresh') === '1';

  try {
    const result = await getOrBuildFeed(supabase, user.id, { forceRefresh });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: 'feed_failed', detail: String(e) },
      { status: 500 }
    );
  }
}
