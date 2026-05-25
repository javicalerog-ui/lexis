// =====================================================
// Refresh summary de una entidad (Sprint 6)
//
// Toma metadatos + memorias asociadas + proyectos + co-ocurrencias,
// pide a Sonnet 4.6 que destile una ficha, persiste el resultado.
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { chat } from '@/lib/llm/escalation';
import { ENTITY_SUMMARY_PROMPT } from './prompts';

const MAX_MEMORIES_IN_PROMPT = 30;
const MAX_COOCCURRENCES_IN_PROMPT = 8;

export interface EntitySummaryResult {
  summary: string;
  key_facts: {
    rol: string | null;
    organization: string | null;
    location: string | null;
    relationship: string | null;
    context: string | null;
  };
  highlights: string[];
  open_threads: string[];
  confidence: number;
  generated_at: string;
  model_used: string;
  memories_considered: number;
}

export async function refreshEntitySummary(
  supabase: SupabaseClient,
  userId: string,
  entityId: string
): Promise<EntitySummaryResult | null> {
  // 1. Entidad
  const { data: entity } = await supabase
    .from('entities')
    .select('id, name, entity_type, aliases, attributes, interaction_count')
    .eq('id', entityId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!entity) throw new Error('Entidad no encontrada');

  // 2. Memorias activas que la mencionan
  const { data: memLinks } = await supabase
    .from('memory_entities')
    .select(
      'role, memories(id, summary, content, source_type, captured_at, status)'
    )
    .eq('entity_id', entityId)
    .limit(80);

  const memories = (memLinks ?? [])
    .map((l: any) => ({
      role: l.role,
      ...l.memories,
    }))
    .filter((m: any) => m && m.status === 'active')
    .sort((a: any, b: any) => (a.captured_at < b.captured_at ? 1 : -1))
    .slice(0, MAX_MEMORIES_IN_PROMPT);

  // Si no hay memorias, no generamos summary y limpiamos el flag stale
  if (memories.length === 0) {
    await supabase
      .from('entities')
      .update({
        rolling_summary: null,
        rolling_summary_updated_at: new Date().toISOString(),
        summary_stale: false,
      })
      .eq('id', entityId);
    return null;
  }

  // 3. Proyectos donde aparece (via las memorias enlazadas)
  const memIds = memories.map((m: any) => m.id);
  const { data: projectLinks } = await supabase
    .from('memory_projects')
    .select('projects(id, name, slug, status)')
    .in('memory_id', memIds);

  const projectMap = new Map<string, { name: string; slug: string; status: string; count: number }>();
  for (const l of projectLinks ?? []) {
    const p: any = (l as any).projects;
    if (!p) continue;
    const prev = projectMap.get(p.id);
    if (prev) prev.count++;
    else projectMap.set(p.id, { name: p.name, slug: p.slug, status: p.status, count: 1 });
  }
  const projects = Array.from(projectMap.values()).sort((a, b) => b.count - a.count);

  // 4. Co-ocurrencias
  const { data: cooccurrences } = await supabase.rpc('entity_cooccurrence', {
    p_entity_id: entityId,
    p_limit: MAX_COOCCURRENCES_IN_PROMPT,
  });

  // 5. Construir prompt
  const memoriesBlock = memories
    .map((m: any, i: number) => {
      const d = m.captured_at?.slice(0, 10) || '?';
      return `[${i + 1}] ${d} · ${m.source_type} · rol=${m.role || 'mentioned'}\n${m.summary || m.content?.slice(0, 400) || ''}`;
    })
    .join('\n\n');

  const projectsBlock = projects.length
    ? projects
        .map((p) => `- ${p.name} (${p.status}, ×${p.count} memorias)`)
        .join('\n')
    : '(no aparece en proyectos)';

  const cooccurrenceBlock =
    cooccurrences && cooccurrences.length
      ? cooccurrences
          .map(
            (c: any) =>
              `- ${c.name} (${c.entity_type}, ×${c.cooccurrences} co-menciones)`
          )
          .join('\n')
      : '(sin co-ocurrencias significativas)';

  const userPrompt = `ENTIDAD:
Nombre: ${entity.name}
Tipo: ${entity.entity_type}
${entity.aliases?.length ? `Aliases: ${entity.aliases.join(', ')}\n` : ''}Atributos previos: ${JSON.stringify(entity.attributes || {})}
Interacciones totales: ${entity.interaction_count}

PROYECTOS EN LOS QUE APARECE:
${projectsBlock}

RED CERCANA (co-ocurrencias):
${cooccurrenceBlock}

MEMORIAS ACTIVAS (más reciente primero, ${memories.length} de ${entity.interaction_count}):
"""
${memoriesBlock}
"""

Genera la ficha.`;

  // 6. LLM tier deep
  const resp = await chat(userPrompt, {
    system: ENTITY_SUMMARY_PROMPT,
    tier: 'deep',
    temperature: 0.35,
    max_tokens: 1500,
    json: true,
  });

  let parsed: Omit<
    EntitySummaryResult,
    'generated_at' | 'model_used' | 'memories_considered'
  >;
  try {
    parsed = JSON.parse(resp.text.trim().replace(/^```json\s*|\s*```$/g, ''));
  } catch (e) {
    throw new Error(`Entity summary LLM JSON no parseable: ${resp.text.slice(0, 300)}`);
  }

  const result: EntitySummaryResult = {
    ...parsed,
    generated_at: new Date().toISOString(),
    model_used: resp.model_used,
    memories_considered: memories.length,
  };

  // 7. Persistir
  await supabase
    .from('entities')
    .update({
      rolling_summary: result.summary,
      rolling_summary_updated_at: result.generated_at,
      key_facts: result.key_facts,
      summary_payload: {
        summary: result.summary,
        key_facts: result.key_facts,
        highlights: result.highlights,
        open_threads: result.open_threads,
        confidence: result.confidence,
        generated_at: result.generated_at,
        model_used: result.model_used,
        memories_considered: result.memories_considered,
      },
      summary_stale: false,
    })
    .eq('id', entityId);

  return result;
}
