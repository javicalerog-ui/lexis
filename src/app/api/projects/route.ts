// =====================================================
// GET /api/projects
// Lista los proyectos del usuario con stats agregadas.
// POST /api/projects
// Crea un proyecto manual (no requerido en MVP pero útil).
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { toSlug } from '@/lib/utils/slug';

export const runtime = 'nodejs';

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data: projects, error } = await supabase
    .from('projects')
    .select(`
      id,
      name,
      slug,
      description,
      status,
      rolling_summary,
      rolling_summary_updated_at,
      last_activity_at,
      created_at
    `)
    .eq('user_id', user.id)
    .order('last_activity_at', { ascending: false, nullsFirst: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Conteo de memorias activas por proyecto
  const ids = (projects ?? []).map((p) => p.id);
  let memoryCounts: Record<string, number> = {};
  if (ids.length) {
    const { data: counts } = await supabase
      .from('memory_projects')
      .select('project_id, memory_id, memories(status)')
      .in('project_id', ids);

    memoryCounts = (counts ?? []).reduce<Record<string, number>>((acc, row: any) => {
      if (row.memories?.status === 'active') {
        acc[row.project_id] = (acc[row.project_id] ?? 0) + 1;
      }
      return acc;
    }, {});
  }

  const enriched = (projects ?? []).map((p) => ({
    ...p,
    memory_count: memoryCounts[p.id] ?? 0,
  }));

  return NextResponse.json({ projects: enriched });
}

const PostSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  status: z.enum(['active', 'paused', 'archived', 'done']).optional(),
});

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof PostSchema>;
  try {
    body = PostSchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: 'invalid_body', detail: String(e) }, { status: 400 });
  }

  const slug = toSlug(body.name);

  const { data, error } = await supabase
    .from('projects')
    .insert({
      user_id: user.id,
      name: body.name,
      slug,
      description: body.description ?? null,
      status: body.status ?? 'active',
      last_activity_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ project: data });
}
