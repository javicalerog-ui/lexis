// =====================================================
// Next-steps generator (Sprint 3)
// Toma proyecto + memorias + entidades + (opcional) pregunta
// y genera pasos accionables con Sonnet 4.6.
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { chat } from '@/lib/llm/escalation';
import { NEXT_STEPS_PROMPT } from './prompts';

const MAX_MEMORIES = 30;
const MAX_ENTITIES = 12;

export interface NextStep {
  action: string;
  rationale: string;
  effort: 'quick' | 'medium' | 'deep';
  depends_on: number[] | null;
}

export interface NextStepsResult {
  context_quality: 'rich' | 'moderate' | 'thin';
  headline: string;
  steps: NextStep[];
  blocking_questions: string[];
  confidence: number;
  generated_at: string;
  model_used: string;
  user_question: string | null;
}

export async function generateNextSteps(
  supabase: SupabaseClient,
  projectId: string,
  userQuestion?: string
): Promise<NextStepsResult> {
  // 1. Proyecto
  const { data: project } = await supabase
    .from('projects')
    .select(
      'id, name, description, status, rolling_summary, rolling_next_steps, last_activity_at'
    )
    .eq('id', projectId)
    .single();

  if (!project) throw new Error('Proyecto no encontrado');

  // 2. Memorias activas asociadas
  const { data: links } = await supabase
    .from('memory_projects')
    .select(
      'memories(id, content, summary, source_type, captured_at, status)'
    )
    .eq('project_id', projectId)
    .limit(80);

  const memories = (links ?? [])
    .map((l: any) => l.memories)
    .filter((m: any) => m && m.status === 'active')
    .sort((a: any, b: any) => (a.captured_at < b.captured_at ? 1 : -1))
    .slice(0, MAX_MEMORIES);

  // 3. Entidades co-ocurrentes (top N)
  let entities: Array<{ name: string; type: string; count: number }> = [];
  if (memories.length) {
    const memIds = memories.map((m: any) => m.id);
    const { data: entLinks } = await supabase
      .from('memory_entities')
      .select('entity_id, entities(name, entity_type)')
      .in('memory_id', memIds);
    const map = new Map<string, { name: string; type: string; count: number }>();
    for (const l of entLinks ?? []) {
      const e: any = (l as any).entities;
      if (!e) continue;
      const key = `${e.name}|${e.entity_type}`;
      const prev = map.get(key);
      if (prev) prev.count++;
      else map.set(key, { name: e.name, type: e.entity_type, count: 1 });
    }
    entities = Array.from(map.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_ENTITIES);
  }

  // 4. Construir prompt
  const memoriesBlock = memories
    .map((m: any, i: number) => {
      const d = m.captured_at?.slice(0, 10) || '?';
      return `[${i + 1}] ${d} · ${m.source_type}\n${m.summary || m.content}`;
    })
    .join('\n\n');

  const entitiesBlock = entities.length
    ? entities.map((e) => `- ${e.name} (${e.type}, ×${e.count})`).join('\n')
    : '(sin entidades relevantes detectadas)';

  const userBlock = userQuestion?.trim()
    ? `\n\nPREGUNTA EXPLÍCITA DEL USUARIO:\n"${userQuestion.trim()}"\n\nResponde priorizando lo que la pregunta busca.`
    : '\n\nNo hay pregunta explícita. Propon los siguientes pasos más útiles dado el estado actual.';

  const userPrompt = `PROYECTO: "${project.name}"
${project.description ? `Descripción: ${project.description}` : ''}
Estado: ${project.status}
Última actividad: ${project.last_activity_at?.slice(0, 10) || 'desconocida'}

ESTADO ACTUAL (rolling_summary):
${project.rolling_summary || '(sin resumen agregado todavía)'}

PRÓXIMOS PASOS ACTUALES (rolling_next_steps, base para refinar):
${project.rolling_next_steps || '(sin propuesta previa)'}

ENTIDADES RELEVANTES:
${entitiesBlock}

MEMORIAS RECIENTES (más reciente primero):
"""
${memoriesBlock || '(sin memorias asociadas todavía)'}
"""${userBlock}

Genera los próximos pasos.`;

  // 5. LLM tier deep — calidad alta, este endpoint corre on-demand
  const resp = await chat(userPrompt, {
    system: NEXT_STEPS_PROMPT,
    tier: 'deep',
    temperature: 0.4,
    max_tokens: 1500,
    json: true,
  });

  let parsed: Omit<NextStepsResult, 'generated_at' | 'model_used' | 'user_question'>;
  try {
    parsed = JSON.parse(resp.text.trim().replace(/^```json\s*|\s*```$/g, ''));
  } catch {
    throw new Error(`LLM devolvió JSON no parseable: ${resp.text.slice(0, 300)}`);
  }

  return {
    ...parsed,
    generated_at: new Date().toISOString(),
    model_used: resp.model_used,
    user_question: userQuestion?.trim() || null,
  };
}
