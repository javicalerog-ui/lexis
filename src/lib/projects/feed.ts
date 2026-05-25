// =====================================================
// Feed proactivo (Sprint 3)
// Agrega proyectos activos y sintetiza qué merece atención.
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { chat } from '@/lib/llm/escalation';
import { FEED_PROMPT } from './prompts';

const STALE_DAYS = 14;
const MAX_PROJECTS_IN_PROMPT = 18;

export type FeedPriority = 'now' | 'this_week' | 'soon';
export type FeedCategory =
  | 'decision'
  | 'action'
  | 'communication'
  | 'review'
  | 'hygiene';

export interface FeedItem {
  title: string;
  detail: string;
  priority: FeedPriority;
  category: FeedCategory;
  related_project_slugs: string[];
  related_entity_names: string[];
}

export interface FeedResult {
  summary: string;
  items: FeedItem[];
  stale_projects: string[];
  confidence: number;
  generated_at: string;
  model_used: string;
  projects_considered: number;
}

export async function generateFeed(
  supabase: SupabaseClient,
  userId: string
): Promise<FeedResult> {
  // 1. Proyectos activos con resumen agregado
  const { data: projects } = await supabase
    .from('projects')
    .select(
      'id, slug, name, description, status, rolling_summary, rolling_next_steps, last_activity_at, rolling_summary_updated_at'
    )
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('last_activity_at', { ascending: false, nullsFirst: false })
    .limit(MAX_PROJECTS_IN_PROMPT);

  if (!projects?.length) {
    return {
      summary: 'No hay proyectos activos.',
      items: [],
      stale_projects: [],
      confidence: 1,
      generated_at: new Date().toISOString(),
      model_used: 'shortcircuit',
      projects_considered: 0,
    };
  }

  // 2. Métricas auxiliares por proyecto
  const ids = projects.map((p) => p.id);
  const { data: memoryStats } = await supabase
    .from('memory_projects')
    .select('project_id, memories(captured_at, status)')
    .in('project_id', ids);

  const stats = new Map<string, { active: number; lastCapture: string | null }>();
  for (const p of projects) stats.set(p.id, { active: 0, lastCapture: null });
  for (const link of memoryStats ?? []) {
    const mem: any = (link as any).memories;
    if (!mem || mem.status !== 'active') continue;
    const s = stats.get(link.project_id);
    if (!s) continue;
    s.active++;
    if (!s.lastCapture || mem.captured_at > s.lastCapture) {
      s.lastCapture = mem.captured_at;
    }
  }

  // 3. Construir bloque de proyectos para el prompt
  const now = Date.now();
  const projectsBlock = projects
    .map((p) => {
      const s = stats.get(p.id);
      const lastCaptureDate = s?.lastCapture ?? p.last_activity_at ?? null;
      const daysSince = lastCaptureDate
        ? Math.floor((now - new Date(lastCaptureDate).getTime()) / 86_400_000)
        : null;
      return `### ${p.name} (slug=${p.slug})
${p.description ? `Descripción: ${p.description}` : ''}
Memorias activas: ${s?.active ?? 0}
Última actividad: ${daysSince === null ? 'desconocida' : `hace ${daysSince}d`}
Estado actual: ${p.rolling_summary || '(sin resumen agregado)'}
Próximos pasos previos: ${p.rolling_next_steps || '(sin propuesta previa)'}`;
    })
    .join('\n\n---\n\n');

  const userPrompt = `Hoy es ${new Date().toISOString().slice(0, 10)}.
Considera "stale" un proyecto sin actividad en ${STALE_DAYS}+ días.

PROYECTOS ACTIVOS DEL USUARIO:

${projectsBlock}

Sintetiza el feed proactivo.`;

  const resp = await chat(userPrompt, {
    system: FEED_PROMPT,
    tier: 'deep',
    temperature: 0.4,
    max_tokens: 2000,
    json: true,
  });

  let parsed: Omit<FeedResult, 'generated_at' | 'model_used' | 'projects_considered'>;
  try {
    parsed = JSON.parse(resp.text.trim().replace(/^```json\s*|\s*```$/g, ''));
  } catch {
    throw new Error(`Feed LLM devolvió JSON no parseable: ${resp.text.slice(0, 300)}`);
  }

  return {
    ...parsed,
    generated_at: new Date().toISOString(),
    model_used: resp.model_used,
    projects_considered: projects.length,
  };
}
