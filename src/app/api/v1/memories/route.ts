// =====================================================
// API v1 · memories
//
// POST /api/v1/memories       — captura una memoria (write scope)
// GET  /api/v1/memories       — lista las recientes (read scope)
//
// Auth: Authorization: Bearer pat_xxxxxxxxxxxxxxxxx
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateApiRequest } from '@/lib/api-v1/auth';
import { ingest } from '@/lib/ingestion/pipeline';
import type { IngestionInput } from '@/types/domain';

export const runtime = 'nodejs';
export const maxDuration = 60;

// ============ POST ============

const CaptureSchema = z.object({
  source_type: z
    .enum(['text', 'voice', 'image', 'pdf', 'xlsx', 'md', 'url'])
    .default('text'),
  content: z.string().min(1).max(40_000),
  source_uri: z.string().optional(),
  source_metadata: z.record(z.unknown()).optional(),
  captured_at: z.string().datetime().optional(),
});

export async function POST(req: Request) {
  const auth = await authenticateApiRequest(req, 'write');
  if (auth instanceof NextResponse) return auth;

  let body: z.infer<typeof CaptureSchema>;
  try {
    body = CaptureSchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_body', detail: String(e) },
      { status: 400 }
    );
  }

  const input: IngestionInput = {
    source_type: body.source_type as IngestionInput['source_type'],
    raw_text: body.content,
    source_uri: body.source_uri,
    source_metadata: {
      ...(body.source_metadata || {}),
      origin: (body.source_metadata as any)?.origin || 'api_v1',
      api_token_id: auth.token_id,
    },
    captured_at: body.captured_at,
  };

  try {
    const result = await ingest(auth.supabase, auth.user_id, input);
    return NextResponse.json(
      {
        memory_id: result.memory_id,
        decision: result.decision,
        summary: result.summary,
        confidence: result.confidence,
      },
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: 'ingest_failed', detail: String(e) },
      { status: 500 }
    );
  }
}

// ============ GET ============

export async function GET(req: Request) {
  const auth = await authenticateApiRequest(req, 'read');
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 200);
  const offset = parseInt(url.searchParams.get('offset') ?? '0');
  const since = url.searchParams.get('since');
  const sourceType = url.searchParams.get('source_type');

  let q = auth.supabase
    .from('memories')
    .select(
      'id, content, summary, source_type, source_metadata, captured_at, ingested_at',
      { count: 'exact' }
    )
    .eq('user_id', auth.user_id)
    .eq('status', 'active')
    .order('captured_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (since) q = q.gte('captured_at', since);
  if (sourceType) q = q.eq('source_type', sourceType);

  const { data, error, count } = await q;
  if (error) {
    return NextResponse.json(
      { error: 'query_failed', detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    items: data ?? [],
    count: data?.length ?? 0,
    total: count ?? null,
    limit,
    offset,
  });
}
