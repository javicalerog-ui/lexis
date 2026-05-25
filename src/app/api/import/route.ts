// =====================================================
// POST /api/import
// Ingesta masiva de items pre-procesados (cliente parseó
// los archivos). El servidor recibe array y los procesa
// secuencialmente respetando límites.
//
// Body: { items: Array<IngestionInput> }
// Response: { processed, results: [...] }
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ingest } from '@/lib/ingestion/pipeline';
import { invalidateFeedCache } from '@/lib/projects/feed-cache';
import type { IngestionInput, SourceType } from '@/types/domain';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_BATCH = 50;

const ItemSchema = z.object({
  source_type: z.enum(['text', 'voice', 'image', 'pdf', 'xlsx', 'md', 'url']),
  raw_text: z.string().min(1).max(40_000),
  source_uri: z.string().optional(),
  source_metadata: z.record(z.unknown()).optional(),
  captured_at: z.string().datetime().optional(),
  label: z.string().optional(),    // título informativo del item, sólo para mostrar progreso
});

const Schema = z.object({
  items: z.array(ItemSchema).min(1).max(MAX_BATCH),
});

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_body', detail: String(e) },
      { status: 400 }
    );
  }

  const results: Array<{
    index: number;
    label?: string;
    status: 'ok' | 'failed';
    memory_id?: string;
    decision?: string;
    error?: string;
  }> = [];

  let okCount = 0;
  let failCount = 0;
  let redundantCount = 0;
  let modificationCount = 0;

  // Procesar secuencialmente. La concurrencia añade riesgo de race conditions
  // en el clasificador (dos memorias creadas al mismo tiempo no se ven entre sí).
  // Para 50 items el coste de secuencial es aceptable.
  for (let i = 0; i < body.items.length; i++) {
    const item = body.items[i];
    try {
      const input: IngestionInput = {
        source_type: item.source_type as SourceType,
        raw_text: item.raw_text,
        source_uri: item.source_uri,
        source_metadata: {
          ...(item.source_metadata || {}),
          origin: 'batch_import',
          batch_index: i,
          batch_size: body.items.length,
        },
        captured_at: item.captured_at,
      };

      const r = await ingest(supabase, user.id, input);
      results.push({
        index: i,
        label: item.label,
        status: 'ok',
        memory_id: r.memory_id,
        decision: r.decision,
      });
      okCount++;
      if (r.decision === 'redundant') redundantCount++;
      if (r.decision === 'modification') modificationCount++;
    } catch (e) {
      results.push({
        index: i,
        label: item.label,
        status: 'failed',
        error: String(e).slice(0, 300),
      });
      failCount++;
    }
  }

  // Invalidar feed cache (el import cambia el estado del grafo)
  await invalidateFeedCache(supabase, user.id);

  return NextResponse.json({
    total: body.items.length,
    ok: okCount,
    failed: failCount,
    redundant: redundantCount,
    modifications: modificationCount,
    new_memories: okCount - redundantCount,
    results,
  });
}
