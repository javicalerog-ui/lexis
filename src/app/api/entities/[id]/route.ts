// =====================================================
// GET /api/entities/[id]
// =====================================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

interface RouteParams {
  params: { id: string };
}

export async function GET(_req: Request, { params }: RouteParams) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data: entity, error } = await supabase
    .from('entities')
    .select('*')
    .eq('user_id', user.id)
    .eq('id', params.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!entity) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Memorias activas que mencionan esta entidad
  const { data: links } = await supabase
    .from('memory_entities')
    .select(
      'role, memories(id, content, summary, source_type, captured_at, status)'
    )
    .eq('entity_id', entity.id)
    .limit(100);

  const memories = (links ?? [])
    .map((r: any) => r.memories)
    .filter((m: any) => m && m.status === 'active')
    .sort((a: any, b: any) => (a.captured_at < b.captured_at ? 1 : -1));

  // Proyectos en los que aparece (vía memorias)
  let projects: Array<{ id: string; slug: string; name: string; status: string; count: number }> = [];
  if (memories.length) {
    const memIds = memories.map((m: any) => m.id);
    const { data: pLinks } = await supabase
      .from('memory_projects')
      .select('project_id, projects(id, slug, name, status)')
      .in('memory_id', memIds);
    const map = new Map<string, { id: string; slug: string; name: string; status: string; count: number }>();
    for (const l of pLinks ?? []) {
      const p: any = (l as any).projects;
      if (!p) continue;
      const prev = map.get(p.id);
      if (prev) prev.count++;
      else map.set(p.id, { id: p.id, slug: p.slug, name: p.name, status: p.status, count: 1 });
    }
    projects = Array.from(map.values()).sort((a, b) => b.count - a.count);
  }

  // Co-ocurrencias (Sprint 6): otras entidades que aparecen junto a esta
  const { data: cooccurrences } = await supabase.rpc('entity_cooccurrence', {
    p_entity_id: entity.id,
    p_limit: 8,
  });

  return NextResponse.json({
    entity,
    memories,
    projects,
    cooccurrences: cooccurrences ?? [],
  });
}
