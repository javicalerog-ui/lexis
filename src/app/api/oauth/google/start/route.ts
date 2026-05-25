// =====================================================
// GET /api/oauth/google/start
//
// Query params:
//   - intent: 'gmail' | 'drive' (define los scopes a pedir)
//   - next:   path al que volver después (default /connectors/new)
//   - connector_name: nombre sugerido para el connector
//   - reuse_credentials_id: si está actualizando credentials existentes
// =====================================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildAuthUrl } from '@/lib/oauth/google';
import { signState, buildSetCookieHeader } from '@/lib/oauth/state';

export const runtime = 'nodejs';

const SCOPES_BY_INTENT: Record<string, string[]> = {
  gmail: [
    'openid',
    'email',
    'https://www.googleapis.com/auth/gmail.readonly',
  ],
  drive: [
    'openid',
    'email',
    'https://www.googleapis.com/auth/drive.readonly',
  ],
  calendar: [
    'openid',
    'email',
    // 'calendar' completo: lectura + escritura de eventos + crear/borrar calendarios
    // (necesario para autocrear "Lexis · Borradores").
    'https://www.googleapis.com/auth/calendar',
  ],
  // Para autorizar varios en un solo flow:
  gmail_drive: [
    'openid',
    'email',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/drive.readonly',
  ],
  full_workspace: [
    'openid',
    'email',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/calendar',
  ],
};

export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  const url = new URL(req.url);
  const intent = (url.searchParams.get('intent') || 'gmail') as keyof typeof SCOPES_BY_INTENT;
  const next = url.searchParams.get('next') || '/connectors/new';
  const connectorName = url.searchParams.get('connector_name') || undefined;
  const adapterType = url.searchParams.get('adapter_type') || undefined;
  const reuseCredentialsId = url.searchParams.get('reuse_credentials_id') || undefined;

  const scopes = SCOPES_BY_INTENT[intent];
  if (!scopes) {
    return NextResponse.json({ error: 'unknown_intent' }, { status: 400 });
  }

  const state = signState({
    user_id: user.id,
    intent: {
      provider: 'google',
      scopes,
      next,
      connector_name: connectorName,
      adapter_type: adapterType,
      reuse_credentials_id: reuseCredentialsId,
    },
  });

  // login_hint opcional desde la sesión (mejora UX)
  const loginHint = user.email || undefined;
  const authUrl = buildAuthUrl({ scopes, state, login_hint: loginHint });

  const res = NextResponse.redirect(authUrl);
  res.headers.append('Set-Cookie', buildSetCookieHeader(state));
  return res;
}
