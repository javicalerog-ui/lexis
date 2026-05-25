// =====================================================
// Interview orchestrator (Sprint 4)
//
// Funciones:
//   - openingQuestion(): primera pregunta dado el foco
//   - nextQuestion(): pregunta siguiente dado el historial
//   - ingestUserResponse(): mete la respuesta como memory
//   - titleSession(): genera título cuando se cierra
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { chat } from '@/lib/llm/escalation';
import { ingest } from '@/lib/ingestion/pipeline';
import { invalidateFeedCache } from '@/lib/projects/feed-cache';
import {
  OPENING_PROMPT,
  INTERVIEWER_PROMPT,
  SESSION_TITLE_PROMPT,
  SESSION_SUMMARY_PROMPT,
} from './prompts';

const MAX_PROJECTS_IN_CONTEXT = 8;
const MAX_ENTITIES_IN_CONTEXT = 10;
const MAX_HISTORY_TURNS = 20;

export interface NextQuestionResult {
  next_question: string;
  reasoning: string;
  topic_shift: boolean;
  saturated: boolean;
  confidence: number;
  model_used: string;
}

export type FocusType = 'open' | 'project' | 'entity';

interface FocusContext {
  focus_type: FocusType;
  focus_id: string | null;
  focus_name?: string;
  focus_summary?: string;
}

// ---------- Contexto del grafo ----------

async function buildGraphContext(
  supabase: SupabaseClient,
  userId: string,
  focus: FocusContext
): Promise<string> {
  const parts: string[] = [];

  // Si hay foco específico, prioriza ese contexto
  if (focus.focus_type === 'project' && focus.focus_id) {
    const { data: p } = await supabase
      .from('projects')
      .select('name, description, status, rolling_summary, rolling_next_steps')
      .eq('id', focus.focus_id)
      .maybeSingle();
    if (p) {
      parts.push(
        `FOCO: proyecto "${p.name}" (${p.status})\n` +
          `Descripción: ${p.description || '(sin descripción)'}\n` +
          `Estado actual: ${p.rolling_summary || '(sin resumen)'}\n` +
          `Próximos pasos previos: ${p.rolling_next_steps || '(ninguno)'}`
      );
    }
  }

  if (focus.focus_type === 'entity' && focus.focus_id) {
    const { data: e } = await supabase
      .from('entities')
      .select('name, entity_type, aliases, attributes, rolling_summary')
      .eq('id', focus.focus_id)
      .maybeSingle();
    if (e) {
      parts.push(
        `FOCO: entidad "${e.name}" (${e.entity_type})\n` +
          (e.aliases?.length ? `Aliases: ${e.aliases.join(', ')}\n` : '') +
          `Atributos: ${JSON.stringify(e.attributes || {})}\n` +
          `Síntesis previa: ${e.rolling_summary || '(sin síntesis)'}`
      );
    }
  }

  // Proyectos top (siempre, para contexto general)
  const { data: projects } = await supabase
    .from('projects')
    .select('name, status, rolling_summary')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('last_activity_at', { ascending: false, nullsFirst: false })
    .limit(MAX_PROJECTS_IN_CONTEXT);

  if (projects?.length) {
    const projectsBlock = projects
      .map((p) => `- ${p.name}: ${p.rolling_summary || '(sin resumen)'}`)
      .join('\n');
    parts.push(`PROYECTOS ACTIVOS DEL USUARIO:\n${projectsBlock}`);
  }

  // Entidades top
  const { data: ents } = await supabase
    .from('entities')
    .select('name, entity_type, last_seen_at')
    .eq('user_id', userId)
    .order('last_seen_at', { ascending: false, nullsFirst: false })
    .limit(MAX_ENTITIES_IN_CONTEXT);

  if (ents?.length) {
    const entsBlock = ents
      .map((e) => `- ${e.name} (${e.entity_type})`)
      .join('\n');
    parts.push(`PERSONAS/ENTIDADES RECIENTES:\n${entsBlock}`);
  }

  return parts.join('\n\n');
}

// ---------- Opening ----------

export async function openingQuestion(
  supabase: SupabaseClient,
  userId: string,
  focus: FocusContext
): Promise<{ question: string; model_used: string }> {
  const graph = await buildGraphContext(supabase, userId, focus);

  const userPrompt = `FOCO DE LA SESIÓN: ${focus.focus_type}
${graph || '(grafo vacío)'}

Genera tu primera pregunta.`;

  const resp = await chat(userPrompt, {
    system: OPENING_PROMPT,
    tier: 'deep',
    temperature: 0.6,
    max_tokens: 200,
  });

  return {
    question: resp.text.trim().replace(/^["']|["']$/g, ''),
    model_used: resp.model_used,
  };
}

// ---------- Next question ----------

interface HistoryTurn {
  role: 'assistant' | 'user';
  content: string;
}

export async function nextQuestion(
  supabase: SupabaseClient,
  userId: string,
  focus: FocusContext,
  history: HistoryTurn[]
): Promise<NextQuestionResult> {
  const graph = await buildGraphContext(supabase, userId, focus);

  // Limitar histórico para no romper el context window
  const recentHistory = history.slice(-MAX_HISTORY_TURNS);
  const historyBlock = recentHistory
    .map((t) => `[${t.role}] ${t.content}`)
    .join('\n\n');

  const userPrompt = `CONTEXTO DEL GRAFO:
${graph || '(grafo vacío)'}

FOCO: ${focus.focus_type}
TURNOS PREVIOS DE LA SESIÓN (${recentHistory.length}):
"""
${historyBlock}
"""

Genera la siguiente pregunta o marca saturated=true.`;

  const resp = await chat(userPrompt, {
    system: INTERVIEWER_PROMPT,
    tier: 'deep',
    temperature: 0.5,
    max_tokens: 500,
    json: true,
  });

  let parsed: Omit<NextQuestionResult, 'model_used'>;
  try {
    parsed = JSON.parse(resp.text.trim().replace(/^```json\s*|\s*```$/g, ''));
  } catch (e) {
    throw new Error(
      `Interviewer LLM devolvió JSON no parseable: ${resp.text.slice(0, 200)}`
    );
  }

  return { ...parsed, model_used: resp.model_used };
}

// ---------- Ingest user response ----------

export async function ingestUserResponse(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  questionAsked: string,
  userResponse: string,
  focus: FocusContext
): Promise<{ memory_id: string; summary: string }> {
  // Construimos un "raw_text" que dé contexto al LLM de resumen sobre
  // el origen (entrevista). El SUMMARIZE_PROMPT seguirá detectando proyectos
  // y entidades.
  const focusHint =
    focus.focus_type === 'project' && focus.focus_name
      ? ` (proyecto: ${focus.focus_name})`
      : focus.focus_type === 'entity' && focus.focus_name
      ? ` (sobre: ${focus.focus_name})`
      : '';

  const rawText = `Entrevista${focusHint}.
Pregunta: ${questionAsked}
Respuesta del usuario: ${userResponse}`;

  const result = await ingest(supabase, userId, {
    source_type: 'text',
    raw_text: rawText,
    source_metadata: {
      origin: 'interview',
      interview_session_id: sessionId,
      question_asked: questionAsked,
      focus_type: focus.focus_type,
      focus_id: focus.focus_id,
    },
  });

  // Si el foco era un proyecto/entidad concreta, garantizamos el enlace
  if (result.memory_id && result.decision !== 'redundant') {
    if (focus.focus_type === 'project' && focus.focus_id) {
      await supabase
        .from('memory_projects')
        .upsert(
          {
            memory_id: result.memory_id,
            project_id: focus.focus_id,
            relevance: 1.0,
            assigned_by: 'interview',
          },
          { onConflict: 'memory_id,project_id', ignoreDuplicates: true }
        );
    }
    if (focus.focus_type === 'entity' && focus.focus_id) {
      await supabase
        .from('memory_entities')
        .upsert(
          {
            memory_id: result.memory_id,
            entity_id: focus.focus_id,
            role: 'subject',
          },
          { onConflict: 'memory_id,entity_id', ignoreDuplicates: true }
        );
    }
  }

  // Invalidamos cache del feed: la entrevista puede mover el estado del grafo.
  await invalidateFeedCache(supabase, userId);

  return {
    memory_id: result.memory_id,
    summary: result.summary,
  };
}

// ---------- Session title (al cerrar) ----------

export async function generateSessionTitle(
  history: HistoryTurn[]
): Promise<string> {
  const block = history
    .slice(0, 16)
    .map((t) => `[${t.role}] ${t.content.slice(0, 200)}`)
    .join('\n');

  const resp = await chat(
    `Conversación:\n${block}\n\nGenera el título.`,
    {
      system: SESSION_TITLE_PROMPT,
      tier: 'fast',
      temperature: 0.4,
      max_tokens: 60,
    }
  );

  return resp.text.trim().replace(/^["']|["']$/g, '').slice(0, 120);
}

// ---------- Session summary (al cerrar) ----------

export interface SessionSummary {
  overview: string;
  highlights: string[];
  connections: string[];
  confidence: number;
  new_projects: Array<{ slug: string; name: string }>;
  new_entities: Array<{ id: string; name: string; type: string }>;
  model_used: string;
  generated_at: string;
}

/**
 * Genera el resumen estructurado de una sesión cerrada.
 *
 * Lee:
 *  - Transcript completo
 *  - Memorias creadas durante la sesión (vía source_metadata.interview_session_id)
 *  - Proyectos y entidades NUEVOS aparecidos durante la sesión
 *    (creados después de session.created_at)
 */
export async function generateSessionSummary(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string
): Promise<SessionSummary> {
  // 1. Sesión
  const { data: session, error: sErr } = await supabase
    .from('interview_sessions')
    .select('id, created_at, focus_type, focus_project_id, focus_entity_id, questions_asked, memories_generated')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .single();

  if (sErr || !session) {
    throw new Error('Sesión no encontrada');
  }

  // 2. Mensajes
  const { data: messages } = await supabase
    .from('interview_messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  const transcript = (messages ?? [])
    .map((m) => `[${m.role}] ${m.content}`)
    .join('\n\n');

  // 3. Memorias de la sesión → proyectos y entidades enlazados
  const { data: sessionMemories } = await supabase
    .from('memories')
    .select('id')
    .eq('user_id', userId)
    .filter('source_metadata->>interview_session_id', 'eq', sessionId);

  const memIds = (sessionMemories ?? []).map((m: any) => m.id);

  let newProjects: Array<{ slug: string; name: string }> = [];
  let newEntities: Array<{ id: string; name: string; type: string }> = [];

  if (memIds.length) {
    // Proyectos enlazados a memorias de la sesión + creados durante la sesión
    const { data: projLinks } = await supabase
      .from('memory_projects')
      .select('projects(slug, name, created_at)')
      .in('memory_id', memIds);

    const projMap = new Map<string, { slug: string; name: string }>();
    for (const link of projLinks ?? []) {
      const p: any = (link as any).projects;
      if (!p) continue;
      // Solo proyectos creados después del inicio de la sesión
      if (p.created_at && p.created_at >= session.created_at) {
        projMap.set(p.slug, { slug: p.slug, name: p.name });
      }
    }
    newProjects = Array.from(projMap.values());

    // Entidades nuevas
    const { data: entLinks } = await supabase
      .from('memory_entities')
      .select('entities(id, name, entity_type, created_at)')
      .in('memory_id', memIds);

    const entMap = new Map<string, { id: string; name: string; type: string }>();
    for (const link of entLinks ?? []) {
      const e: any = (link as any).entities;
      if (!e) continue;
      if (e.created_at && e.created_at >= session.created_at) {
        entMap.set(e.id, { id: e.id, name: e.name, type: e.entity_type });
      }
    }
    newEntities = Array.from(entMap.values());
  }

  // 4. Prompt al LLM
  const projectsBlock = newProjects.length
    ? newProjects.map((p) => `- ${p.name} (${p.slug})`).join('\n')
    : '(ninguno)';

  const entitiesBlock = newEntities.length
    ? newEntities.map((e) => `- ${e.name} (${e.type})`).join('\n')
    : '(ninguna)';

  const userPrompt = `TRANSCRIPT (${messages?.length ?? 0} mensajes, ${session.questions_asked} preguntas, ${session.memories_generated} memorias creadas):

"""
${transcript}
"""

PROYECTOS NUEVOS DETECTADOS DURANTE LA SESIÓN:
${projectsBlock}

ENTIDADES NUEVAS DETECTADAS DURANTE LA SESIÓN:
${entitiesBlock}

Genera el resumen.`;

  const resp = await chat(userPrompt, {
    system: SESSION_SUMMARY_PROMPT,
    tier: 'deep',
    temperature: 0.3,
    max_tokens: 1200,
    json: true,
  });

  let parsed: { overview: string; highlights: string[]; connections: string[]; confidence: number };
  try {
    parsed = JSON.parse(resp.text.trim().replace(/^```json\s*|\s*```$/g, ''));
  } catch {
    throw new Error(`Session summary LLM no devolvió JSON parseable: ${resp.text.slice(0, 300)}`);
  }

  return {
    ...parsed,
    new_projects: newProjects,
    new_entities: newEntities,
    model_used: resp.model_used,
    generated_at: new Date().toISOString(),
  };
}
