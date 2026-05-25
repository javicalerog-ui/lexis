// =====================================================
// GET /api/projects/[slug]
// PATCH /api/projects/[slug]
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { refreshProjectSummary } from '@/lib/projects/refresh-summary';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface RouteParams {
  params: { slug: string };
}

export async function GET(req: Request, { params }: RouteParams) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data: project, error } = await supabase
    .from('projects')
    .select('*')
    .eq('user_id', user.id)
    .eq('slug', params.slug)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!project) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Refresh oportunista del rolling_summary si está stale
  const url = new URL(req.url);
  const wantsRefresh = url.searchParams.get('refresh') === '1';
  const refresh = await refreshProjectSummary(supabase, project.id, {
    force: wantsRefresh,
  });

  // Recargar si se refrescó
  const fresh =
    refresh.refreshed
      ? (
          await supabase
            .from('projects')
            .select('*')
            .eq('id', project.id)
            .single()
        ).data
      : project;

  // Cargar memorias activas asociadas (top 50, más reciente primero)
  const { data: memLinks } = await supabase
    .from('memory_projects')
    .select(
      'relevance, memories(id, content, summary, source_type, captured_at, status)'
    )
    .eq('project_id', project.id)
    .limit(50);

  const memories = (memLinks ?? [])
    .map((r: any) => r.memories)
    .filter((m: any) => m && m.status === 'active')
    .sort((a: any, b: any) => (a.captured_at < b.captured_at ? 1 : -1));

  // Entidades co-ocurrentes (las que aparecen en las memorias del proyecto)
  let coEntities: Array<{ id: string; name: string; entity_type: string; count: number }> = [];
  if (memories.length) {
    const memIds = memories.map((m: any) => m.id);
    const { data: entLinks } = await supabase
      .from('memory_entities')
      .select('entity_id, entities(id, name, entity_type)')
      .in('memory_id', memIds);
    const map = new Map<string, { id: string; name: string; entity_type: string; count: number }>();
    for (const l of entLinks ?? []) {
      const e: any = (l as any).entities;
      if (!e) continue;
      const prev = map.get(e.id);
      if (prev) prev.count++;
      else map.set(e.id, { id: e.id, name: e.name, entity_type: e.entity_type, count: 1 });
    }
    coEntities = Array.from(map.values()).sort((a, b) => b.count - a.count);
  }

  return NextResponse.json({
    project: fresh,
    memories,
    co_entities: coEntities,
    refresh,
  });
}

const PatchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(500).optional(),
  status: z.enum(['active', 'paused', 'archived', 'done']).optional(),
});

export async function PATCH(req: Request, { params }: RouteParams) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof PatchSchema>;
  try {
    body = PatchSchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: 'invalid_body', detail: String(e) }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('projects')
    .update(body)
    .eq('user_id', user.id)
    .eq('slug', params.slug)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ project: data });
}
