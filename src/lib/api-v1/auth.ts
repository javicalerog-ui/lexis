// =====================================================
// API v1 authentication
//
// Para endpoints públicos protegidos por PAT:
//   - Header obligatorio: `Authorization: Bearer pat_xxxxx`
//   - Devuelve { user_id, scopes, supabase: ServiceClient } o respuesta de error.
//   - Usa el service role client para hacer queries (saltando RLS),
//     pero todas las queries filtran manualmente por user_id.
// =====================================================

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { hashToken, isValidTokenFormat } from './tokens';

export type Scope = 'read' | 'write';

export interface AuthContext {
  user_id: string;
  token_id: string;
  scopes: Scope[];
  supabase: ReturnType<typeof createServiceClient>;
}

export async function authenticateApiRequest(
  req: Request,
  requiredScope?: Scope
): Promise<AuthContext | NextResponse> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json(
      { error: 'unauthorized', detail: 'Authorization header missing' },
      { status: 401 }
    );
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return NextResponse.json(
      {
        error: 'unauthorized',
        detail: 'Expected "Authorization: Bearer pat_..."',
      },
      { status: 401 }
    );
  }

  const plain = match[1].trim();
  if (!isValidTokenFormat(plain)) {
    return NextResponse.json(
      { error: 'unauthorized', detail: 'Invalid token format' },
      { status: 401 }
    );
  }

  const hash = hashToken(plain);
  const supabase = createServiceClient();

  const { data: token } = await supabase
    .from('personal_access_tokens')
    .select('id, user_id, scopes, revoked_at, expires_at')
    .eq('token_hash', hash)
    .maybeSingle();

  if (!token) {
    return NextResponse.json(
      { error: 'unauthorized', detail: 'Token not found' },
      { status: 401 }
    );
  }

  if (token.revoked_at) {
    return NextResponse.json(
      { error: 'unauthorized', detail: 'Token revoked' },
      { status: 401 }
    );
  }

  if (token.expires_at && new Date(token.expires_at) < new Date()) {
    return NextResponse.json(
      { error: 'unauthorized', detail: 'Token expired' },
      { status: 401 }
    );
  }

  const scopes = (token.scopes ?? []) as Scope[];
  if (requiredScope && !scopes.includes(requiredScope)) {
    return NextResponse.json(
      {
        error: 'forbidden',
        detail: `Token lacks "${requiredScope}" scope`,
        scopes,
      },
      { status: 403 }
    );
  }

  // Bump last_used_at asíncronamente (no bloquear la respuesta)
  const ip =
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    null;
  const userAgent = req.headers.get('user-agent') ?? null;
  supabase
    .rpc('bump_pat_last_used', {
      p_token_hash: hash,
      p_ip: ip,
      p_user_agent: userAgent?.slice(0, 200) ?? null,
    })
    .then(() => {});

  return {
    user_id: token.user_id,
    token_id: token.id,
    scopes,
    supabase,
  };
}
