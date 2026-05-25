// =====================================================
// POST /api/connectors/[id]/inbound  — público
//
// Recibe POST de fuentes externas (Zapier, IFTTT, n8n, curl, etc.)
// Validación: header X-Connector-Secret debe matchear webhook_secret_hash.
//
// Acepta:
//   - Content-Type: application/json  → payload parseado como JSON
//   - Content-Type: text/plain        → payload = string
//   - Cualquier otro                  → payload = string del body
//
// El connector debe ser de un tipo con supports_webhook=true.
// =====================================================

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { runConnector } from '@/lib/connectors/runner';
import { hashWebhookSecret } from '@/lib/connectors/webhook-secret';
import { getAdapter } from '@/lib/connectors/registry';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface RouteParams {
  params: { id: string };
}

export async function POST(req: Request, { params }: RouteParams) {
  // 1. Validar secret
  const incomingSecret =
    req.headers.get('x-connector-secret') ||
    new URL(req.url).searchParams.get('secret') ||
    '';

  if (!incomingSecret) {
    return NextResponse.json(
      { error: 'missing_secret', detail: 'Header X-Connector-Secret o ?secret= requerido' },
      { status: 401 }
    );
  }

  const supabase = createServiceClient();
  const incomingHash = hashWebhookSecret(incomingSecret);

  // 2. Lookup connector
  const { data: connector } = await supabase
    .from('connectors')
    .select(
      'id, user_id, type, enabled, webhook_secret_hash'
    )
    .eq('id', params.id)
    .maybeSingle();

  if (!connector || !connector.webhook_secret_hash) {
    // Mismo mensaje para no filtrar si existe o no
    return NextResponse.json(
      { error: 'invalid_secret' },
      { status: 401 }
    );
  }

  if (connector.webhook_secret_hash !== incomingHash) {
    return NextResponse.json(
      { error: 'invalid_secret' },
      { status: 401 }
    );
  }

  if (!connector.enabled) {
    return NextResponse.json(
      { error: 'connector_disabled' },
      { status: 423 }
    );
  }

  const adapter = getAdapter(connector.type);
  if (!adapter || !adapter.supports_webhook) {
    return NextResponse.json(
      { error: 'webhook_not_supported' },
      { status: 400 }
    );
  }

  // 3. Parsear payload
  const contentType = req.headers.get('content-type') || '';
  let payload: unknown;

  try {
    if (contentType.includes('application/json')) {
      payload = await req.json();
    } else {
      payload = await req.text();
    }
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_payload', detail: String(e) },
      { status: 400 }
    );
  }

  // 4. Ejecutar
  try {
    const summary = await runConnector(supabase, params.id, connector.user_id, {
      trigger: 'webhook',
      webhook_payload: payload,
    });
    return NextResponse.json({ run: summary }, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { error: 'run_failed', detail: String(e) },
      { status: 500 }
    );
  }
}
