// =====================================================
// POST /api/connectors/[id]/run
// Ejecuta un connector manualmente (botón "Ejecutar ahora" en UI).
// =====================================================

import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { runConnector } from '@/lib/connectors/runner';

export const runtime = 'nodejs';
export const maxDuration = 120;

interface RouteParams {
  params: { id: string };
}

export async function POST(_req: Request, { params }: RouteParams) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Verificar ownership con el client de sesión, luego ejecutar con service
  const { data: connector } = await supabase
    .from('connectors')
    .select('id, user_id')
    .eq('id', params.id)
    .maybeSingle();

  if (!connector || connector.user_id !== user.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  try {
    const summary = await runConnector(
      createServiceClient(),
      params.id,
      user.id,
      { trigger: 'manual' }
    );
    return NextResponse.json({ run: summary });
  } catch (e) {
    return NextResponse.json(
      { error: 'run_failed', detail: String(e) },
      { status: 500 }
    );
  }
}
