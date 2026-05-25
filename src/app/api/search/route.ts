// =====================================================
// POST /api/search
// Búsqueda semántica con filtros ricos (Sprint 8).
//
// Body: { query: string, filters?: Filters, match_count?, min_similarity? }
// Si filters está presente, los aplica en el RPC. Si query está vacío,
// devuelve los matches más recientes que cumplan los filtros (modo "browse").
// =====================================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { embedOne } from '@/lib/embeddings/voyage';
import { SearchSchema, enrichMemories } from '@/lib/search/filters';

export const runtime = 'nodejs';
export const maxDuration = 30;

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
    body = SearchSchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_body', detail: String(e) },
      { status: 400 }
    );
  }

  const filters = body.filters ?? {};
  const hasQuery = !!body.query?.trim();
  const queryEmbedding = hasQuery ? await embedOne(body.query!, 'query') : null;

  const { data, error } = await supabase.rpc('search_memories_filtered', {
    p_user_id: user.id,
    p_query_embedding: queryEmbedding,
    p_match_count: body.match_count ?? 20,
    p_min_similarity: body.min_similarity ?? 0.35,
    p_project_ids: filters.project_ids ?? null,
    p_entity_ids: filters.entity_ids ?? null,
    p_source_types: filters.source_types ?? null,
    p_origins: filters.origins ?? null,
    p_date_from: filters.date_from ?? null,
    p_date_to: filters.date_to ?? null,
  });

  if (error) {
    return NextResponse.json(
      { error: 'search_failed', detail: error.message },
      { status: 500 }
    );
  }

  const enriched = await enrichMemories(supabase, data ?? []);

  return NextResponse.json({
    query: body.query ?? null,
    filters_applied: filters,
    count: enriched.length,
    results: enriched,
  });
}
