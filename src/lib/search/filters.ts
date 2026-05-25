// =====================================================
// Tipos compartidos para filtros de búsqueda y timeline.
// =====================================================

import { z } from 'zod';

export const SourceTypeSchema = z.enum([
  'text',
  'voice',
  'image',
  'pdf',
  'xlsx',
  'md',
  'url',
]);

export type SourceType = z.infer<typeof SourceTypeSchema>;

export const KNOWN_ORIGINS = [
  'capture',                 // captura manual normal (default cuando no hay origin)
  'interview',               // respuesta de entrevista
  'batch_import',            // importer masivo
  'next_step_completion',    // marcar paso completado
] as const;

export type KnownOrigin = (typeof KNOWN_ORIGINS)[number];

export const FilterSchema = z.object({
  project_ids: z.array(z.string().uuid()).optional(),
  entity_ids: z.array(z.string().uuid()).optional(),
  source_types: z.array(SourceTypeSchema).optional(),
  origins: z.array(z.string()).optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
});

export type Filters = z.infer<typeof FilterSchema>;

export const SearchSchema = z.object({
  query: z.string().min(1).max(2000).optional(),
  match_count: z.number().int().min(1).max(100).optional(),
  min_similarity: z.number().min(0).max(1).optional(),
  filters: FilterSchema.optional(),
});

export type SearchInput = z.infer<typeof SearchSchema>;

export const TimelineSchema = z.object({
  filters: FilterSchema.optional(),
  cursor: z.string().datetime().optional(),    // captured_at del último item de la página previa
  limit: z.number().int().min(1).max(100).default(40),
});

export type TimelineInput = z.infer<typeof TimelineSchema>;

// Helpers para enriquecer resultados con datos relacionados

export interface MemoryRow {
  id: string;
  content: string;
  summary: string | null;
  source_type: SourceType;
  source_metadata: Record<string, unknown> | null;
  captured_at: string;
  similarity?: number;
}

export interface EnrichedMemory extends MemoryRow {
  projects: Array<{ id: string; slug: string; name: string }>;
  entities: Array<{ id: string; name: string; entity_type: string }>;
}

/**
 * Dado un set de MemoryRow, busca sus enlaces a proyectos y entidades
 * y devuelve EnrichedMemory[]. Una sola query batch por relación.
 */
export async function enrichMemories(
  supabase: any,
  rows: MemoryRow[]
): Promise<EnrichedMemory[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);

  const [pRes, eRes] = await Promise.all([
    supabase
      .from('memory_projects')
      .select('memory_id, projects(id, slug, name)')
      .in('memory_id', ids),
    supabase
      .from('memory_entities')
      .select('memory_id, entities(id, name, entity_type)')
      .in('memory_id', ids),
  ]);

  const projByMem = new Map<string, EnrichedMemory['projects']>();
  for (const l of pRes.data ?? []) {
    const p = (l as any).projects;
    if (!p) continue;
    const arr = projByMem.get((l as any).memory_id) || [];
    arr.push({ id: p.id, slug: p.slug, name: p.name });
    projByMem.set((l as any).memory_id, arr);
  }

  const entByMem = new Map<string, EnrichedMemory['entities']>();
  for (const l of eRes.data ?? []) {
    const e = (l as any).entities;
    if (!e) continue;
    const arr = entByMem.get((l as any).memory_id) || [];
    arr.push({ id: e.id, name: e.name, entity_type: e.entity_type });
    entByMem.set((l as any).memory_id, arr);
  }

  return rows.map((r) => ({
    ...r,
    projects: projByMem.get(r.id) || [],
    entities: entByMem.get(r.id) || [],
  }));
}
