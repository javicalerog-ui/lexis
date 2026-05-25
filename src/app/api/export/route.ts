// =====================================================
// POST /api/export
// Genera y devuelve el JSON completo del grafo del usuario.
//
// Body opcional:
// {
//   date_from?: ISO,
//   date_to?: ISO,
//   include_interviews?: boolean,    // default true
//   include_digests?: boolean,       // default true
//   include_embeddings?: boolean,    // default false (1024 floats x N memorias = grande)
//   as_download?: boolean            // default true; si true, devuelve con Content-Disposition
// }
//
// Acepta auth de sesión normal O Personal Access Token (read scope).
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { authenticateApiRequest } from '@/lib/api-v1/auth';
import { buildExport } from '@/lib/export/build';

export const runtime = 'nodejs';
export const maxDuration = 300;

const Schema = z.object({
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  include_interviews: z.boolean().default(true),
  include_digests: z.boolean().default(true),
  include_embeddings: z.boolean().default(false),
  as_download: z.boolean().default(true),
});

export async function POST(req: Request) {
  // Doble vía de auth: sesión normal (browser) o PAT (API)
  let userId: string | null = null;
  let supabase;

  const hasAuthHeader = req.headers.get('authorization');
  if (hasAuthHeader) {
    const auth = await authenticateApiRequest(req, 'read');
    if (auth instanceof NextResponse) return auth;
    userId = auth.user_id;
    supabase = auth.supabase;
  } else {
    supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    userId = user.id;
  }

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await req.json().catch(() => ({})));
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_body', detail: String(e) },
      { status: 400 }
    );
  }

  try {
    const result = await buildExport(supabase, userId!, {
      date_from: body.date_from,
      date_to: body.date_to,
      include_interviews: body.include_interviews,
      include_digests: body.include_digests,
      include_embeddings: body.include_embeddings,
    });

    const json = JSON.stringify(result, null, 2);

    if (body.as_download) {
      const dateStamp = new Date().toISOString().slice(0, 10);
      return new NextResponse(json, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="lexis-export-${dateStamp}.json"`,
          'X-Memory-Count': String(result.meta.counts.memories),
          'X-Schema-Version': result.meta.schema_version,
        },
      });
    }

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: 'export_failed', detail: String(e) },
      { status: 500 }
    );
  }
}

// GET para inspeccionar metadata sin generar todavía
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data: snapshot } = await supabase.rpc('user_metrics_snapshot', {
    p_user_id: user.id,
  });

  return NextResponse.json({
    estimated_counts: snapshot,
    schema_version: '1.0',
    available_tables: [
      'memories',
      'projects',
      'entities',
      'memory_projects',
      'memory_entities',
      'interview_sessions (optional)',
      'interview_messages (optional)',
      'digests (optional)',
    ],
    note: 'POST con body opcional para generar el export. Default incluye entrevistas y digests, no embeddings.',
  });
}
