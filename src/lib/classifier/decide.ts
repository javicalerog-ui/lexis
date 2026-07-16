// =====================================================
// Classifier — decide new / modification / redundant
//
// Pasos:
//  1. Buscar memorias similares por embedding (top K)
//  2. Si la mejor < umbral, decisión rápida: 'new' (no llama LLM)
//  3. Si hay candidatas próximas, llama al LLM con resumen + candidatas
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { chatWithEscalation } from '@/lib/llm/escalation';
import { CLASSIFIER_PROMPT } from './prompts';

export interface ClassifierInput {
  user_id: string;
  candidate_summary: string;
  candidate_content: string;
  candidate_embedding: number[];
  project_filter?: string | null;   // si la nueva memoria ya está asociada a un proyecto, restringe
}

export interface ClassifierDecision {
  decision: 'new' | 'modification' | 'redundant';
  target_memory_id: string | null;
  reasoning: string;
  confidence: number;
  llm_used: boolean;
  candidates_considered: number;
}

const QUICK_NEW_THRESHOLD = 0.65;   // similitud máx por debajo → 'new' sin LLM
const CANDIDATES_TOP_K = 5;

interface CandidateMemory {
  id: string;
  content: string;
  summary: string | null;
  similarity: number;
  captured_at: string;
}

export async function classify(
  supabase: SupabaseClient,
  input: ClassifierInput
): Promise<ClassifierDecision> {
  // 1. Vecinas más similares. p_user_id explícito: bajo service client
  // (API v1 /capture, crons) auth.uid() es NULL y sin él la RPC no vería
  // vecinas (el clasificador jamás deduplicaría). Requiere la migración
  // hardening2 (20260706000000).
  const { data: neighbors, error } = await supabase.rpc('search_memories', {
    query_embedding: input.candidate_embedding,
    match_count: CANDIDATES_TOP_K,
    min_similarity: 0.5,
    project_filter: input.project_filter ?? null,
    entity_filter: null,
    p_user_id: input.user_id,
  });

  if (error) {
    throw new Error(`Classifier neighbor search failed: ${error.message}`);
  }

  const candidates = (neighbors ?? []) as CandidateMemory[];

  // 2. Atajo: ninguna candidata cercana → 'new' sin gastar LLM
  if (!candidates.length || candidates[0].similarity < QUICK_NEW_THRESHOLD) {
    return {
      decision: 'new',
      target_memory_id: null,
      reasoning: 'Sin memorias suficientemente similares en el corpus.',
      confidence: 1,
      llm_used: false,
      candidates_considered: candidates.length,
    };
  }

  // 3. LLM decide con las candidatas
  const candidatesBlock = candidates
    .map(
      (c, i) =>
        `[${i + 1}] id=${c.id} · similitud=${(c.similarity * 100).toFixed(0)}% · captured=${c.captured_at.slice(0, 10)}\n${c.summary || c.content}`
    )
    .join('\n\n');

  const userPrompt = `ENTRADA NUEVA:
"""
${input.candidate_summary}

${input.candidate_content}
"""

MEMORIAS EXISTENTES MÁS SIMILARES (top ${candidates.length}):
"""
${candidatesBlock}
"""

Decide.`;

  const { parsed } = await chatWithEscalation<{
    decision: 'new' | 'modification' | 'redundant';
    target_memory_id: string | null;
    reasoning: string;
    confidence: number;
  }>(userPrompt, {
    system: CLASSIFIER_PROMPT,
    temperature: 0.1,
    max_tokens: 400,
    confidence_field: 'confidence',
  });

  // Validar que target_memory_id esté en las candidatas si no es 'new'.
  let decision = parsed.decision;
  let target = parsed.target_memory_id;
  if (decision !== 'new') {
    const valid = candidates.find((c) => c.id === target);
    if (!valid) {
      // El LLM devolvió un id que NO está entre las candidatas (alucinación o
      // null). NO inventamos una candidata (antes se forzaba candidates[0]):
      // degradamos a 'new'. Pisar/descartar una memoria buena por una
      // alucinación es justo lo que "cero invención" prohíbe, y perder
      // información es peor que duplicar.
      decision = 'new';
      target = null;
    }
  } else {
    target = null;
  }

  return {
    decision,
    target_memory_id: target,
    reasoning: parsed.reasoning,
    confidence: parsed.confidence,
    llm_used: true,
    candidates_considered: candidates.length,
  };
}
