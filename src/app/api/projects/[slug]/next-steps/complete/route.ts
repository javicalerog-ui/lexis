// =====================================================
// POST /api/projects/[slug]/next-steps/complete
// Cuando el usuario marca un paso como hecho, creamos una
// memoria automáticamente que alimenta el grafo. La próxima
// generación de pasos partirá de un contexto actualizado.
//
// Body: { action, notes?, effort_actual?, status? }
//   - action: la frase del paso completado (la mostramos al user)
//   - notes: comentario opcional del usuario sobre cómo fue
//   - effort_actual: 'quick' | 'medium' | 'deep' (cuánto le costó realmente)
//   - status: 'done' (default) | 'partial' | 'skipped'
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ingest } from '@/lib/ingestion/pipeline';
import { invalidateFeedCache } from '@/lib/projects/feed-cache';

export const runtime = 'nodejs';
export const maxDuration = 60;

const Schema = z.object({
  action: z.string().min(2).max(500),
  notes: z.string().max(2000).optional(),
  effort_actual: z.enum(['quick', 'medium', 'deep']).optional(),
  status: z.enum(['done', 'partial', 'skipped']).default('done'),
});

interface RouteParams {
  params: { slug: string };
}

const STATUS_VERB: Record<'done' | 'partial' | 'skipped', string> = {
  done: 'He completado',
  partial: 'He avanzado parcialmente con',
  skipped: 'He decidido descartar',
};

export async function POST(req: Request, { params }: RouteParams) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_body', detail: String(e) },
      { status: 400 }
    );
  }

  // Resolver proyecto
  const { data: project } = await supabase
    .from('projects')
    .select('id, name, slug')
    .eq('user_id', user.id)
    .eq('slug', params.slug)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: 'project_not_found' }, { status: 404 });
  }

  // Construir texto de la memoria autogenerada
  const verb = STATUS_VERB[body.status];
  const lines: string[] = [
    `${verb} el paso "${body.action}" en el proyecto ${project.name}.`,
  ];
  if (body.notes?.trim()) {
    lines.push(`Notas: ${body.notes.trim()}`);
  }
  if (body.effort_actual) {
    lines.push(`Esfuerzo real: ${body.effort_actual}.`);
  }
  const rawText = lines.join('\n');

  try {
    const result = await ingest(supabase, user.id, {
      source_type: 'text',
      raw_text: rawText,
      source_metadata: {
        origin: 'next_step_completion',
        project_slug: project.slug,
        status: body.status,
        completed_action: body.action,
      },
    });

    // Asegurar que la memoria queda enlazada al proyecto incluso si el
    // clasificador no lo detectó (caso típico: textos cortos sin
    // entidades claras).
    await supabase
      .from('memory_projects')
      .upsert(
        {
          memory_id: result.memory_id,
          project_id: project.id,
          relevance: 1.0,
          assigned_by: 'next_step_completion',
        },
        { onConflict: 'memory_id,project_id', ignoreDuplicates: true }
      );

    // Bumpear actividad y estado del proyecto
    await supabase
      .from('projects')
      .update({ last_activity_at: new Date().toISOString() })
      .eq('id', project.id);

    // El paso completado cambia significativamente el contexto:
    // invalidamos el cache del feed para que la próxima carga refleje el cambio.
    await invalidateFeedCache(supabase, user.id);

    return NextResponse.json({
      memory_id: result.memory_id,
      decision: result.decision,
      summary: result.summary,
      project_slug: project.slug,
      completed_action: body.action,
      status: body.status,
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'completion_failed', detail: String(e) },
      { status: 500 }
    );
  }
}
