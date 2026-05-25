// =====================================================
// Pipeline de ingestión (server-side) — Sprint 2
//
// Pasos:
//   1. LLM resume + extrae metadatos (proyectos, entidades, fecha)
//   2. Embed del summary + content_normalized
//   3. CLASIFICADOR: ¿es nueva / modifica una existente / redundante?
//      - Si redundante → no insertamos, log y retorno temprano
//      - Si modificación → marcamos la antigua como superseded
//   4. INSERT memory
//   5. Resolver proyectos y entidades, ATTACH
//   6. Heredar attachments si era modification
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { chatWithEscalation } from '@/lib/llm/escalation';
import { SUMMARIZE_PROMPT } from '@/lib/llm/prompts';
import { embedOne } from '@/lib/embeddings/voyage';
import { classify } from '@/lib/classifier/decide';
import { attachMemoryToProjects } from '@/lib/projects/attach';
import { attachMemoryToEntities } from '@/lib/entities/attach';
import { extractAndPersistEvents } from '@/lib/events/extractor';
import type { IngestionInput, IngestionResult } from '@/types/domain';

interface SummarizeOutput {
  summary_md: string;
  content_normalized: string;
  projects: string[];
  entities: Array<{ name: string; type: string }>;
  captured_at_iso: string | null;
  confidence: number;
}

export async function ingest(
  supabase: SupabaseClient,
  userId: string,
  input: IngestionInput
): Promise<IngestionResult> {
  const t0 = Date.now();

  // 1. Resumen + extracción
  const userPrompt = `Tipo de fuente: ${input.source_type}
Metadatos: ${JSON.stringify(input.source_metadata || {}).slice(0, 500)}

Entrada cruda:
"""
${input.raw_text.slice(0, 12_000)}
"""`;

  const { parsed, meta } = await chatWithEscalation<SummarizeOutput>(
    userPrompt,
    {
      system: SUMMARIZE_PROMPT,
      temperature: 0.2,
      max_tokens: 800,
      confidence_field: 'confidence' as keyof SummarizeOutput,
    }
  );

  // 2. Embedding
  const embedText = [parsed.content_normalized, parsed.summary_md]
    .filter(Boolean)
    .join('\n');
  const embedding = await embedOne(embedText, 'document');

  // 3. Clasificador
  const decision = await classify(supabase, {
    user_id: userId,
    candidate_summary: parsed.summary_md,
    candidate_content: parsed.content_normalized,
    candidate_embedding: embedding,
  });

  // 3.a. Redundante → no insertamos
  if (decision.decision === 'redundant' && decision.target_memory_id) {
    await supabase.from('ingestion_log').insert({
      user_id: userId,
      source_uri: input.source_uri ?? null,
      input_excerpt: input.raw_text.slice(0, 500),
      status: 'completed',
      decision: 'redundant',
      decision_confidence: decision.confidence,
      decision_model: decision.llm_used ? meta.model_used : 'shortcircuit',
      modified_memory_id: decision.target_memory_id,
      resulting_memory_id: null,
      processing_ms: Date.now() - t0,
    });

    return {
      memory_id: decision.target_memory_id,
      decision: 'redundant',
      summary: parsed.summary_md,
      confidence: decision.confidence,
    };
  }

  // 3.b. Modificación → marcar la antigua como superseded
  if (decision.decision === 'modification' && decision.target_memory_id) {
    await supabase
      .from('memories')
      .update({ status: 'superseded' })
      .eq('id', decision.target_memory_id)
      .eq('user_id', userId);
  }

  // 4. INSERT memory
  const capturedAt =
    input.captured_at ?? parsed.captured_at_iso ?? new Date().toISOString();

  const { data: memory, error } = await supabase
    .from('memories')
    .insert({
      user_id: userId,
      content: parsed.content_normalized,
      summary: parsed.summary_md,
      raw_excerpt: input.raw_text.slice(0, 2000),
      source_type: input.source_type,
      source_uri: input.source_uri ?? null,
      source_metadata: {
        ...(input.source_metadata || {}),
        llm_model: meta.model_used,
        llm_tier: meta.tier_used,
        supersedes: decision.decision === 'modification' ? decision.target_memory_id : null,
        classifier_reasoning: decision.reasoning,
      },
      embedding,
      captured_at: capturedAt,
    })
    .select('id')
    .single();

  if (error || !memory) {
    throw new Error(`No se pudo insertar memory: ${error?.message}`);
  }

  // 5. Attach proyectos y entidades
  const attachedProjects = await attachMemoryToProjects(
    supabase,
    userId,
    memory.id,
    parsed.projects || []
  );
  const attachedEntities = await attachMemoryToEntities(
    supabase,
    userId,
    memory.id,
    parsed.entities || []
  );

  // 6. Heredar attachments si era modification
  if (decision.decision === 'modification' && decision.target_memory_id) {
    await inheritAttachments(supabase, decision.target_memory_id, memory.id);
  }

  // 6.b. Extractor de eventos (Sprint 15). No bloqueante: si falla,
  // el ingest sigue siendo exitoso. Skip si el adapter origen es
  // calendar porque esos eventos ya vienen estructurados y los crea
  // el runner del connector directamente en la tabla `events`.
  const originIsCalendar =
    (input.source_metadata as any)?.origin === 'connector_calendar' ||
    (input.source_metadata as any)?.connector_type === 'calendar' ||
    (input.source_metadata as any)?.connector_origin === 'calendar';

  if (!originIsCalendar) {
    try {
      const inferredSource =
        input.source_type === 'voice'
          ? 'voice'
          : input.source_type === 'image'
            ? 'image'
            : 'text';
      await extractAndPersistEvents(supabase, {
        userId,
        memoryId: memory.id,
        capturedAtUtc: capturedAt ? new Date(capturedAt) : new Date(),
        rawText: input.raw_text,
        summary: parsed.summary_md,
        linkedProjectId: attachedProjects[0]?.project_id ?? null,
        linkedEntityId: attachedEntities[0]?.entity_id ?? null,
        source: inferredSource as 'voice' | 'image' | 'text',
      });
    } catch (e) {
      console.error('[ingest] event extractor failed (non-fatal)', e);
    }
  }

  // 7. Log
  await supabase.from('ingestion_log').insert({
    user_id: userId,
    source_uri: input.source_uri ?? null,
    input_excerpt: input.raw_text.slice(0, 500),
    status: 'completed',
    decision: decision.decision,
    decision_confidence: decision.confidence,
    decision_model: decision.llm_used ? meta.model_used : 'shortcircuit',
    resulting_memory_id: memory.id,
    modified_memory_id:
      decision.decision === 'modification' ? decision.target_memory_id : null,
    processing_ms: Date.now() - t0,
  });

  return {
    memory_id: memory.id,
    decision: decision.decision,
    summary: parsed.summary_md,
    confidence: decision.confidence,
    attached_projects: attachedProjects,
    attached_entities: attachedEntities,
  } as IngestionResult;
}

async function inheritAttachments(
  supabase: SupabaseClient,
  oldMemoryId: string,
  newMemoryId: string
) {
  const { data: oldProjects } = await supabase
    .from('memory_projects')
    .select('project_id, relevance, assigned_by')
    .eq('memory_id', oldMemoryId);

  if (oldProjects?.length) {
    await supabase
      .from('memory_projects')
      .upsert(
        oldProjects.map((p) => ({
          memory_id: newMemoryId,
          project_id: p.project_id,
          relevance: p.relevance,
          assigned_by: p.assigned_by,
        })),
        { onConflict: 'memory_id,project_id', ignoreDuplicates: true }
      );
  }

  const { data: oldEntities } = await supabase
    .from('memory_entities')
    .select('entity_id, role')
    .eq('memory_id', oldMemoryId);

  if (oldEntities?.length) {
    await supabase
      .from('memory_entities')
      .upsert(
        oldEntities.map((e) => ({
          memory_id: newMemoryId,
          entity_id: e.entity_id,
          role: e.role,
        })),
        { onConflict: 'memory_id,entity_id', ignoreDuplicates: true }
      );
  }
}
