// =====================================================
// GET /api/entities — lista entidades
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
  const type = url.searchParams.get('type'); // person | org | place | concept | product

  let query = supabase
    .from('entities')
    .select('id, name, entity_type, aliases, attributes, last_seen_at, created_at')
    .eq('user_id', user.id)
    .order('last_seen_at', { ascending: false, nullsFirst: false });

  if (type) {
    query = query.eq('entity_type', type);
  }

  const { data: entities, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Conteo de menciones por entidad
  const ids = (entities ?? []).map((e) => e.id);
  let counts: Record<string, number> = {};
  if (ids.length) {
    const { data: links } = await supabase
      .from('memory_entities')
      .select('entity_id, memories(status)')
      .in('entity_id', ids);
    counts = (links ?? []).reduce<Record<string, number>>((acc, l: any) => {
      if (l.memories?.status === 'active') {
        acc[l.entity_id] = (acc[l.entity_id] ?? 0) + 1;
      }
      return acc;
    }, {});
  }

  const enriched = (entities ?? []).map((e) => ({
    ...e,
    mention_count: counts[e.id] ?? 0,
  }));

  return NextResponse.json({ entities: enriched });
}
