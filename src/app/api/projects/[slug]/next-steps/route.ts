// =====================================================
// POST /api/projects/[slug]/next-steps
// Genera siguientes pasos accionables para un proyecto.
// Body opcional: { question: string }
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { generateNextSteps } from '@/lib/projects/next-steps';

export const runtime = 'nodejs';
export const maxDuration = 90;

interface RouteParams {
  params: { slug: string };
}

const Schema = z.object({
  question: z.string().max(500).optional(),
});

export async function POST(req: Request, { params }: RouteParams) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof Schema> = {};
  try {
    const text = await req.text();
    if (text) body = Schema.parse(JSON.parse(text));
  } catch (e) {
    return NextResponse.json({ error: 'invalid_body', detail: String(e) }, { status: 400 });
  }

  const { data: project, error } = await supabase
    .from('projects')
    .select('id, slug')
    .eq('user_id', user.id)
    .eq('slug', params.slug)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!project) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  try {
    const result = await generateNextSteps(supabase, project.id, body.question);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: 'generation_failed', detail: String(e) },
      { status: 500 }
    );
  }
}
