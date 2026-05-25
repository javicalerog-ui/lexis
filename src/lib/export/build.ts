// =====================================================
// Builder del export completo
//
// Estrategia: en chunks para no explotar memoria con grafos grandes.
// El consumidor recibe un objeto en memoria; si el grafo crece mucho,
// futuro: streaming JSON. Para uso personal (<100k memorias) basta.
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ExportFilters {
  date_from?: string;
  date_to?: string;
  include_interviews?: boolean;
  include_digests?: boolean;
  include_embeddings?: boolean;
}

export interface ExportResult {
  meta: {
    user_id: string;
    exported_at: string;
    schema_version: '1.0';
    filters: ExportFilters;
    counts: Record<string, number>;
  };
  projects: any[];
  entities: any[];
  memories: any[];
  memory_projects: any[];
  memory_entities: any[];
  interview_sessions?: any[];
  interview_messages?: any[];
  digests?: any[];
}

const PAGE_SIZE = 1000;

async function fetchAll<T>(
  builder: (from: number, to: number) => Promise<{ data: T[] | null; error: any }>
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await builder(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

export async function buildExport(
  supabase: SupabaseClient,
  userId: string,
  filters: ExportFilters = {}
): Promise<ExportResult> {
  const exportedAt = new Date().toISOString();

  // 1. Memories (con o sin embeddings)
  const memoryFields = filters.include_embeddings
    ? 'id, user_id, content, summary, source_type, source_uri, source_metadata, captured_at, ingested_at, status, embedding'
    : 'id, user_id, content, summary, source_type, source_uri, source_metadata, captured_at, ingested_at, status';

  const memories = await fetchAll((from, to) => {
    let q = supabase
      .from('memories')
      .select(memoryFields)
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('captured_at', { ascending: true })
      .range(from, to);
    if (filters.date_from) q = q.gte('captured_at', filters.date_from);
    if (filters.date_to) q = q.lte('captured_at', filters.date_to);
    return q;
  });

  const memoryIds = memories.map((m: any) => m.id);

  // 2. Projects y entidades del user
  const projects = await fetchAll((from, to) =>
    supabase
      .from('projects')
      .select(
        'id, user_id, name, slug, description, status, rolling_summary, rolling_next_steps, last_activity_at, rolling_summary_updated_at, created_at'
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .range(from, to)
  );

  const entities = await fetchAll((from, to) =>
    supabase
      .from('entities')
      .select(
        'id, user_id, name, entity_type, aliases, attributes, key_facts, rolling_summary, rolling_summary_updated_at, summary_payload, interaction_count, last_seen_at, created_at'
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .range(from, to)
  );

  // 3. Relaciones (solo las de las memorias filtradas)
  let memoryProjects: any[] = [];
  let memoryEntities: any[] = [];
  if (memoryIds.length) {
    // Chunking para no exceder el límite de IN (...) de Postgres
    const CHUNK = 500;
    for (let i = 0; i < memoryIds.length; i += CHUNK) {
      const chunk = memoryIds.slice(i, i + CHUNK);
      const [mpRes, meRes] = await Promise.all([
        supabase
          .from('memory_projects')
          .select('memory_id, project_id, relevance, assigned_by, created_at')
          .in('memory_id', chunk),
        supabase
          .from('memory_entities')
          .select('memory_id, entity_id, role, created_at')
          .in('memory_id', chunk),
      ]);
      if (mpRes.data) memoryProjects.push(...mpRes.data);
      if (meRes.data) memoryEntities.push(...meRes.data);
    }
  }

  const result: ExportResult = {
    meta: {
      user_id: userId,
      exported_at: exportedAt,
      schema_version: '1.0',
      filters,
      counts: {
        memories: memories.length,
        projects: projects.length,
        entities: entities.length,
        memory_projects: memoryProjects.length,
        memory_entities: memoryEntities.length,
      },
    },
    projects,
    entities,
    memories,
    memory_projects: memoryProjects,
    memory_entities: memoryEntities,
  };

  // 4. Entrevistas (opcional)
  if (filters.include_interviews) {
    const sessions = await fetchAll((from, to) => {
      let q = supabase
        .from('interview_sessions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .range(from, to);
      if (filters.date_from) q = q.gte('created_at', filters.date_from);
      if (filters.date_to) q = q.lte('created_at', filters.date_to);
      return q;
    });

    const sessionIds = sessions.map((s: any) => s.id);
    let messages: any[] = [];
    if (sessionIds.length) {
      const CHUNK = 500;
      for (let i = 0; i < sessionIds.length; i += CHUNK) {
        const chunk = sessionIds.slice(i, i + CHUNK);
        const { data } = await supabase
          .from('interview_messages')
          .select('*')
          .in('session_id', chunk);
        if (data) messages.push(...data);
      }
    }

    result.interview_sessions = sessions;
    result.interview_messages = messages;
    result.meta.counts.interview_sessions = sessions.length;
    result.meta.counts.interview_messages = messages.length;
  }

  // 5. Digests (opcional)
  if (filters.include_digests) {
    const digests = await fetchAll((from, to) => {
      let q = supabase
        .from('digests')
        .select(
          'id, user_id, period_start, period_end, cadence, payload, metrics, status, sent_at, sent_to, model_used, generated_at'
        )
        .eq('user_id', userId)
        .order('generated_at', { ascending: true })
        .range(from, to);
      if (filters.date_from) q = q.gte('period_start', filters.date_from);
      if (filters.date_to) q = q.lte('period_end', filters.date_to);
      return q;
    });
    result.digests = digests;
    result.meta.counts.digests = digests.length;
  }

  return result;
}
