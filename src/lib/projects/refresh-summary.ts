// =====================================================
// Rolling summary de proyectos
// Agregamos las últimas N memorias del proyecto y le
// pedimos al LLM que regenere:
//   - estado actual (rolling_summary)
//   - próximos pasos sugeridos (rolling_next_steps)
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { chat } from '@/lib/llm/escalation';
import { embedOne } from '@/lib/embeddings/voyage';

const MAX_MEMORIES_PER_REFRESH = 40;
const STALENESS_HOURS = 1;

const REFRESH_PROMPT = `Eres el módulo de síntesis de Lexis. Recibes la información de un proyecto del usuario y un listado de las últimas memorias asociadas (la más reciente primero).

Genera DOS cosas en Markdown breve y accionable:

1. **Estado actual** (rolling_summary): un párrafo describiendo dónde está el proyecto AHORA. Recoge decisiones tomadas, lo último que ha pasado, bloqueos activos. Habla en presente. Máximo 6 líneas.

2. **Próximos pasos** (rolling_next_steps): lista 3-6 acciones concretas que el usuario podría/debería hacer a continuación, ordenadas por prioridad. Cada una en una línea, con verbo en infinitivo al principio. No inventes; deriva de las memorias.

DEVUELVE EXCLUSIVAMENTE este JSON:
{
  "rolling_summary": string,
  "rolling_next_steps": string
}

Sin texto fuera del JSON, sin fences \`\`\`.`;

interface RefreshResult {
  project_id: string;
  refreshed: boolean;
  reason: string;
}

export async function refreshProjectSummary(
  supabase: SupabaseClient,
  projectId: string,
  opts: { force?: boolean } = {}
): Promise<RefreshResult> {
  // 1. Cargar proyecto
  const { data: project, error: pErr } = await supabase
    .from('projects')
    .select('id, name, description, status, rolling_summary_updated_at, last_activity_at')
    .eq('id', projectId)
    .single();

  if (pErr || !project) {
    return { project_id: projectId, refreshed: false, reason: 'project_not_found' };
  }

  // 2. ¿Vale la pena refrescar?
  if (!opts.force && project.rolling_summary_updated_at) {
    const ageMs =
      Date.now() - new Date(project.rolling_summary_updated_at).getTime();
    const lastActivity = project.last_activity_at
      ? new Date(project.last_activity_at).getTime()
      : 0;
    const summaryNewerThanActivity =
      new Date(project.rolling_summary_updated_at).getTime() >= lastActivity;
    if (ageMs < STALENESS_HOURS * 60 * 60 * 1000 && summaryNewerThanActivity) {
      return { project_id: projectId, refreshed: false, reason: 'fresh' };
    }
  }

  // 3. Últimas memorias del proyecto
  const { data: memoryLinks } = await supabase
    .from('memory_projects')
    .select('memory_id, memories(id, content, summary, captured_at, source_type, status)')
    .eq('project_id', projectId)
    .order('memory_id', { ascending: false })
    .limit(MAX_MEMORIES_PER_REFRESH);

  const memories = (memoryLinks ?? [])
    .map((m: any) => m.memories)
    .filter((m: any) => m && m.status === 'active')
    .sort((a: any, b: any) =>
      a.captured_at < b.captured_at ? 1 : -1
    );

  if (!memories.length) {
    return { project_id: projectId, refreshed: false, reason: 'no_memories' };
  }

  // 4. Construir prompt
  const memoriesBlock = memories
    .map((m: any, i: number) => {
      const d = m.captured_at?.slice(0, 10) || '?';
      return `[${i + 1}] ${d} · ${m.source_type}\n${m.summary || m.content}`;
    })
    .join('\n\n');

  const userPrompt = `Proyecto: "${project.name}"
Descripción: ${project.description || '(sin descripción)'}
Estado: ${project.status}

ÚLTIMAS MEMORIAS (más reciente primero):
"""
${memoriesBlock}
"""

Sintetiza el estado y los próximos pasos.`;

  // 5. LLM (tier deep para calidad, este endpoint corre raramente)
  const resp = await chat(userPrompt, {
    system: REFRESH_PROMPT,
    tier: 'deep',
    temperature: 0.3,
    max_tokens: 1200,
    json: true,
  });

  let parsed: { rolling_summary: string; rolling_next_steps: string };
  try {
    parsed = JSON.parse(
      resp.text.trim().replace(/^```json\s*|\s*```$/g, '')
    );
  } catch {
    return { project_id: projectId, refreshed: false, reason: 'llm_parse_failed' };
  }

  // 6. Embedding del summary para hacer match futuro
  const embedding = await embedOne(
    `${project.name}. ${parsed.rolling_summary}`,
    'document'
  ).catch(() => null);

  // 7. UPDATE
  const { error: uErr } = await supabase
    .from('projects')
    .update({
      rolling_summary: parsed.rolling_summary,
      rolling_next_steps: parsed.rolling_next_steps,
      rolling_summary_updated_at: new Date().toISOString(),
      embedding,
    })
    .eq('id', projectId);

  if (uErr) {
    return { project_id: projectId, refreshed: false, reason: `update_failed:${uErr.message}` };
  }

  return { project_id: projectId, refreshed: true, reason: 'ok' };
}
