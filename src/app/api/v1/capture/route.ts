// =====================================================
// API v1 · capture — Sprint 0.5 de Acta (2026-07-04)
//
// POST /api/v1/capture — ingesta programática (write scope)
//
// Consumidor primario: el LexisSink de Acta (actas de reunión),
// pero es genérico: cualquier integración con PAT write puede
// capturar memorias.
//
// Idempotencia: si source_metadata.external_id viene y ya existe
// una memoria de este usuario con ese external_id, devolvemos la
// existente con 200 (deduplicated: true) en lugar de re-ingerir.
// Respaldado a nivel de BD por el índice único parcial
// memories_user_external_id_uniq (migración hardening 2026-05-26).
//
// PREREQUISITOS (bundle de auditoría 2026-07-04):
//   - Fix de middleware: sin él, /api/v1/* redirige a /auth/login.
//   - Migración hardening2 (search_memories con p_user_id): el
//     pipeline corre aquí con service client; sin ese fix el
//     clasificador no vería vecinas y nunca deduplicaría.
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateApiRequest } from '@/lib/api-v1/auth';
import { ingest } from '@/lib/ingestion/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 60;

const Schema = z.object({
  source_type: z.enum(['text', 'voice', 'image', 'pdf', 'xlsx', 'md', 'url']),
  raw_text: z.string().min(1).max(200_000),
  source_uri: z.string().optional(),
  source_metadata: z.record(z.unknown()).optional(),
  captured_at: z.string().datetime({ offset: true }).optional(),
});

export async function POST(req: Request) {
  const auth = await authenticateApiRequest(req, 'write');
  if (auth instanceof NextResponse) return auth;

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_body', detail: String(e) },
      { status: 400 }
    );
  }

  // ---- Idempotencia por external_id ----
  const externalId =
    typeof body.source_metadata?.external_id === 'string'
      ? (body.source_metadata.external_id as string)
      : null;

  if (externalId) {
    const { data: existing, error: exErr } = await auth.supabase
      .from('memories')
      .select('id, summary, status')
      .eq('user_id', auth.user_id)
      .eq('source_metadata->>external_id', externalId)
      .limit(1)
      .maybeSingle();

    if (exErr) {
      return NextResponse.json(
        { error: 'lookup_failed', detail: exErr.message },
        { status: 500 }
      );
    }
    if (existing) {
      return NextResponse.json(
        {
          memory_id: existing.id,
          decision: 'duplicate_external_id',
          deduplicated: true,
          summary: existing.summary,
        },
        { status: 200 }
      );
    }
  }

  // ---- Ingesta por el pipeline estándar ----
  try {
    const result = await ingest(auth.supabase, auth.user_id, {
      source_type: body.source_type,
      raw_text: body.raw_text,
      source_uri: body.source_uri,
      source_metadata: body.source_metadata,
      captured_at: body.captured_at,
    });

    return NextResponse.json(
      {
        memory_id: result.memory_id,
        decision: result.decision,
        confidence: result.confidence,
        summary: result.summary,
        deduplicated: result.decision === 'redundant',
      },
      { status: 201 }
    );
  } catch (e) {
    // Carrera improbable: dos entregas simultáneas con el mismo
    // external_id. El índice único convierte la segunda en 23505;
    // la resolvemos devolviendo la memoria ya insertada.
    const msg = e instanceof Error ? e.message : String(e);
    if (externalId && msg.includes('memories_user_external_id_uniq')) {
      const { data: winner } = await auth.supabase
        .from('memories')
        .select('id, summary')
        .eq('user_id', auth.user_id)
        .eq('source_metadata->>external_id', externalId)
        .limit(1)
        .maybeSingle();
      if (winner) {
        return NextResponse.json(
          {
            memory_id: winner.id,
            decision: 'duplicate_external_id',
            deduplicated: true,
            summary: winner.summary,
          },
          { status: 200 }
        );
      }
    }
    return NextResponse.json(
      { error: 'ingest_failed', detail: msg.slice(0, 400) },
      { status: 500 }
    );
  }
}
