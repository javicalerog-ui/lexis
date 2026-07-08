// =====================================================
// Generador del digest periódico (Sprint 7)
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { chat } from '@/lib/llm/escalation';
import { DIGEST_PROMPT } from './prompts';

const MAX_PROJECTS_IN_PROMPT = 12;
const MAX_MEMORIES_IN_PROMPT = 30;
const MAX_DECISIONS_IN_PROMPT = 10;
const STALE_DAYS_THRESHOLD = 14;

export interface DigestMovement {
  project_slug: string | null;
  title: string;
  detail: string;
}
export interface DigestDecision {
  title: string;
  detail: string;
}
export interface DigestStalled {
  title: string;
  days_idle: number;
  suggestion: string;
}
export interface DigestPerson {
  name: string;
  context: string;
}

export interface DigestPayload {
  headline: string;
  overview: string;
  what_moved: DigestMovement[];
  decisions: DigestDecision[];
  stalled: DigestStalled[];
  people: DigestPerson[];
  open_question: string | null;
  tone_note: string;
}

export interface DigestMetrics {
  new_memories: number;
  by_source_type: Record<string, number>;
  new_projects: number;
  new_entities: number;
  projects_touched: number;
  decisions_count: number;
  busiest_day: string | null;          // ISO date
  busiest_day_count: number;
}

export interface GeneratedDigest {
  payload: DigestPayload;
  metrics: DigestMetrics;
  period_start: string;
  period_end: string;
  cadence: 'weekly' | 'biweekly' | 'monthly';
  model_used: string;
  generated_at: string;
}

// ---------- Helpers ----------

function periodForCadence(
  cadence: 'weekly' | 'biweekly' | 'monthly',
  endRef = new Date()
): { start: Date; end: Date } {
  const end = new Date(endRef);
  const start = new Date(end);
  if (cadence === 'weekly') start.setDate(end.getDate() - 7);
  else if (cadence === 'biweekly') start.setDate(end.getDate() - 14);
  else start.setDate(end.getDate() - 30);
  return { start, end };
}

// ---------- Main ----------

export async function generateDigest(
  supabase: SupabaseClient,
  userId: string,
  cadence: 'weekly' | 'biweekly' | 'monthly' = 'weekly',
  options: { periodEnd?: Date } = {}
): Promise<GeneratedDigest> {
  const { start, end } = periodForCadence(cadence, options.periodEnd);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  // ============ Métricas crudas (SQL) ============

  // Nuevas memorias en el periodo
  const { data: memoriesInPeriod } = await supabase
    .from('memories')
    .select('id, summary, content, source_type, source_metadata, captured_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .gte('captured_at', startIso)
    .lte('captured_at', endIso)
    .order('captured_at', { ascending: false });

  const newMemories = memoriesInPeriod ?? [];

  // Agregaciones
  const bySource: Record<string, number> = {};
  const byDay = new Map<string, number>();
  let decisionsCount = 0;
  for (const m of newMemories) {
    bySource[m.source_type] = (bySource[m.source_type] ?? 0) + 1;
    const day = (m.captured_at as string).slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
    const origin = (m.source_metadata as any)?.origin;
    if (origin === 'next_step_completion') decisionsCount++;
  }

  let busiestDay: string | null = null;
  let busiestCount = 0;
  for (const [day, count] of byDay) {
    if (count > busiestCount) {
      busiestCount = count;
      busiestDay = day;
    }
  }

  // Proyectos creados en el periodo
  const { data: newProjectsRaw } = await supabase
    .from('projects')
    .select('id, name, slug, created_at, status, rolling_summary')
    .eq('user_id', userId)
    .gte('created_at', startIso)
    .lte('created_at', endIso);
  const newProjects = newProjectsRaw ?? [];

  // Entidades creadas en el periodo
  const { count: newEntitiesCount } = await supabase
    .from('entities')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', startIso)
    .lte('created_at', endIso);

  // Proyectos tocados (con memoria nueva en el periodo)
  const memIds = newMemories.map((m) => m.id);
  let projectsTouched: Array<{ id: string; name: string; slug: string; status: string; rolling_summary: string | null; rolling_next_steps: string | null; touch_count: number; last_activity_at: string | null }> = [];
  if (memIds.length) {
    const { data: pLinks } = await supabase
      .from('memory_projects')
      .select(
        'project_id, projects(id, name, slug, status, rolling_summary, rolling_next_steps, last_activity_at)'
      )
      .in('memory_id', memIds);

    const map = new Map<string, any>();
    for (const l of pLinks ?? []) {
      const p: any = (l as any).projects;
      if (!p) continue;
      const prev = map.get(p.id);
      if (prev) prev.touch_count++;
      else map.set(p.id, { ...p, touch_count: 1 });
    }
    projectsTouched = Array.from(map.values())
      .sort((a, b) => b.touch_count - a.touch_count)
      .slice(0, MAX_PROJECTS_IN_PROMPT);
  }

  // Proyectos parados: activos sin actividad en STALE_DAYS_THRESHOLD+ días
  const staleCutoff = new Date(end);
  staleCutoff.setDate(end.getDate() - STALE_DAYS_THRESHOLD);
  const { data: stalledProjects } = await supabase
    .from('projects')
    .select('id, name, slug, last_activity_at, rolling_summary, rolling_next_steps')
    .eq('user_id', userId)
    .eq('status', 'active')
    .lt('last_activity_at', staleCutoff.toISOString())
    .order('last_activity_at', { ascending: false, nullsFirst: true })
    .limit(6);

  // Personas/entidades centrales: las que aparecen en más memorias del periodo
  let topEntities: Array<{ name: string; entity_type: string; count: number; rolling_summary: string | null }> = [];
  if (memIds.length) {
    const { data: eLinks } = await supabase
      .from('memory_entities')
      .select('entity_id, entities(id, name, entity_type, rolling_summary)')
      .in('memory_id', memIds);
    const map = new Map<string, any>();
    for (const l of eLinks ?? []) {
      const e: any = (l as any).entities;
      if (!e) continue;
      const prev = map.get(e.id);
      if (prev) prev.count++;
      else map.set(e.id, { ...e, count: 1 });
    }
    topEntities = Array.from(map.values())
      .filter((e) => e.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }

  // Decisiones / completions del periodo
  const decisions = newMemories
    .filter((m) => (m.source_metadata as any)?.origin === 'next_step_completion')
    .slice(0, MAX_DECISIONS_IN_PROMPT);

  // Memorias destacables (top por longitud y recencia, máx N)
  const highlights = newMemories
    .filter((m) => (m.summary || m.content || '').length > 80)
    .slice(0, MAX_MEMORIES_IN_PROMPT);

  const metrics: DigestMetrics = {
    new_memories: newMemories.length,
    by_source_type: bySource,
    new_projects: newProjects.length,
    new_entities: newEntitiesCount ?? 0,
    projects_touched: projectsTouched.length,
    decisions_count: decisionsCount,
    busiest_day: busiestDay,
    busiest_day_count: busiestCount,
  };

  // ============ Caso vacío: sin actividad significativa ============
  if (newMemories.length === 0) {
    return {
      payload: {
        headline: 'Periodo sin actividad registrada en Lexis.',
        overview:
          'No se ha capturado ninguna memoria en este periodo. Si has tenido actividad, considera importar o usar el entrevistador para volcarla.',
        what_moved: [],
        decisions: [],
        stalled: (stalledProjects ?? []).map((p) => ({
          title: p.name,
          days_idle: p.last_activity_at
            ? Math.floor((Date.now() - new Date(p.last_activity_at).getTime()) / 86_400_000)
            : 999,
          suggestion: 'Considera archivarlo si ya no es relevante.',
        })),
        people: [],
        open_question: null,
        tone_note: 'Periodo silencioso.',
      },
      metrics,
      period_start: startIso,
      period_end: endIso,
      cadence,
      model_used: 'shortcircuit',
      generated_at: new Date().toISOString(),
    };
  }

  // ============ Prompt al LLM ============

  const movedBlock = projectsTouched
    .map(
      (p) =>
        `### ${p.name} (slug=${p.slug}, ${p.touch_count} memorias nuevas)\nEstado actual: ${p.rolling_summary || '(sin resumen)'}\nPróximos pasos: ${p.rolling_next_steps || '(ninguno)'}`
    )
    .join('\n\n');

  const decisionsBlock = decisions.length
    ? decisions
        .map((d) => `- ${d.summary || d.content}`)
        .join('\n')
    : '(sin decisiones/completions registradas)';

  const stalledBlock = (stalledProjects ?? []).length
    ? (stalledProjects ?? [])
        .map((p) => {
          const days = p.last_activity_at
            ? Math.floor((Date.now() - new Date(p.last_activity_at).getTime()) / 86_400_000)
            : 999;
          return `- ${p.name} (slug=${p.slug}, ${days}d parado): ${p.rolling_summary || '(sin resumen)'}`;
        })
        .join('\n')
    : '(sin proyectos parados)';

  const entitiesBlock = topEntities.length
    ? topEntities
        .map(
          (e) =>
            `- ${e.name} (${e.entity_type}, ×${e.count} en el periodo): ${e.rolling_summary || '(sin síntesis)'}`
        )
        .join('\n')
    : '(sin entidades destacadas)';

  const highlightsBlock = highlights
    .slice(0, 12)
    .map((m) => {
      const d = (m.captured_at as string).slice(0, 10);
      return `[${d}] ${m.summary || m.content?.slice(0, 200) || ''}`;
    })
    .join('\n\n');

  const userPrompt = `PERIODO: ${startIso.slice(0, 10)} → ${endIso.slice(0, 10)} (${cadence})

MÉTRICAS:
- Nuevas memorias: ${metrics.new_memories} (${Object.entries(metrics.by_source_type).map(([k, v]) => `${v} ${k}`).join(', ')})
- Nuevos proyectos: ${metrics.new_projects}
- Nuevas entidades: ${metrics.new_entities}
- Proyectos tocados: ${metrics.projects_touched}
- Decisiones/pasos completados: ${metrics.decisions_count}
- Día más activo: ${metrics.busiest_day || 'n/a'} (${metrics.busiest_day_count} memorias)

PROYECTOS CON ACTIVIDAD EN EL PERIODO:
${movedBlock || '(ninguno)'}

DECISIONES / PASOS COMPLETADOS:
${decisionsBlock}

PROYECTOS PARADOS (>${STALE_DAYS_THRESHOLD}d):
${stalledBlock}

PERSONAS/ENTIDADES CENTRALES:
${entitiesBlock}

MEMORIAS DESTACABLES DEL PERIODO:
"""
${highlightsBlock || '(sin memorias largas significativas)'}
"""

Genera el digest editorial.`;

  const resp = await chat(userPrompt, {
    system: DIGEST_PROMPT,
    tier: 'deep',
    temperature: 0.4,
    max_tokens: 2200,
    json: true,
  });

  let parsed: DigestPayload;
  try {
    parsed = JSON.parse(resp.text.trim().replace(/^```json\s*|\s*```$/g, ''));
  } catch (e) {
    throw new Error(
      `Digest LLM JSON no parseable: ${resp.text.slice(0, 300)}`
    );
  }

  return {
    payload: parsed,
    metrics,
    period_start: startIso,
    period_end: endIso,
    cadence,
    model_used: resp.model_used,
    generated_at: new Date().toISOString(),
  };
}
