// =====================================================
// POST /api/timeline
// Lista cronológica de memorias con filtros y paginación cursor-based.
// Body: { filters?, cursor?, limit? }
// =====================================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { TimelineSchema, enrichMemories } from '@/lib/search/filters';

export const runtime = 'nodejs';
export const maxDuration = 20;

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body;
  try {
    body = TimelineSchema.parse(await req.json().catch(() => ({})));
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_body', detail: String(e) },
      { status: 400 }
    );
  }

  const filters = body.filters ?? {};

  // Reutilizamos search_memories_filtered sin query embedding.
  // El RPC ordena por captured_at desc cuando no hay embedding.
  // Aplicamos el cursor manualmente por captured_at.
  const dateTo = body.cursor || filters.date_to || null;

  const { data, error } = await supabase.rpc('search_memories_filtered', {
    p_user_id: user.id,
    p_query_embedding: null,
    p_match_count: body.limit + 1,            // pedimos uno extra para saber si hay next
    p_min_similarity: 0,
    p_project_ids: filters.project_ids ?? null,
    p_entity_ids: filters.entity_ids ?? null,
    p_source_types: filters.source_types ?? null,
    p_origins: filters.origins ?? null,
    p_date_from: filters.date_from ?? null,
    p_date_to: dateTo,
  });

  if (error) {
    return NextResponse.json(
      { error: 'timeline_failed', detail: error.message },
      { status: 500 }
    );
  }

  const rows = data ?? [];
  const hasMore = rows.length > body.limit;
  const page = hasMore ? rows.slice(0, body.limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1].captured_at : null;

  const enriched = await enrichMemories(supabase, page);

  return NextResponse.json({
    count: enriched.length,
    has_more: hasMore,
    next_cursor: nextCursor,
    items: enriched,
  });
}
