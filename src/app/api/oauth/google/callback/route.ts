// =====================================================
// GET /api/oauth/google/callback
//
// Recibe ?code=...&state=...
//
// Pasos:
//   1. Validar que la cookie de state == query state
//   2. Verificar firma HMAC del state
//   3. Verificar que user_id del state == sesión actual
//   4. Intercambiar code → tokens
//   5. Fetch userinfo para email
//   6. Persistir en connector_credentials
//      - Si reuse_credentials_id: UPDATE
//      - Si no: INSERT (con dedup por user_id+provider+account_identifier)
//   7. Redirigir a `next?credentials_id=<id>`
// =====================================================

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { exchangeCodeForTokens, fetchUserInfo } from '@/lib/oauth/google';
import {
  verifyState,
  readStateCookie,
  buildClearCookieHeader,
} from '@/lib/oauth/state';
import {
  assertCredentialEncryptionReady,
} from '@/lib/security/credential-encryption.mjs';
import {
  encryptCredentialValues,
  loadDecryptedRefreshTokenById,
  resolveCredentialRefreshToken,
} from '@/lib/connectors/credentials';

export const runtime = 'nodejs';

function errorRedirect(req: Request, code: string): NextResponse {
  const url = new URL('/oauth/google/error', req.url);
  url.searchParams.set('code', code);
  const res = NextResponse.redirect(url);
  res.headers.append('Set-Cookie', buildClearCookieHeader());
  return res;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const userErr = url.searchParams.get('error');

  if (userErr) {
    return errorRedirect(req, 'google_denied');
  }
  if (!code || !stateParam) {
    return errorRedirect(req, 'missing_params');
  }

  // 1+2. Validar cookie y firma
  const stateCookie = readStateCookie(req.headers.get('cookie'));
  if (!stateCookie || stateCookie !== stateParam) {
    return errorRedirect(req, 'state_mismatch');
  }

  const payload = verifyState(stateParam);
  if (!payload) {
    return errorRedirect(req, 'invalid_state');
  }

  // 3. Verificar sesión
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return errorRedirect(req, 'no_session');
  }
  if (user.id !== payload.user_id) {
    return errorRedirect(req, 'user_mismatch');
  }

  // Do not consume the one-time OAuth code unless secure persistence is ready.
  try {
    assertCredentialEncryptionReady();
  } catch {
    return errorRedirect(req, 'credential_encryption_unavailable');
  }

  // 4. Intercambiar code
  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch {
    return errorRedirect(req, 'token_exchange_failed');
  }

  // 5. Fetch userinfo
  let userinfo;
  try {
    userinfo = await fetchUserInfo(tokens.access_token);
  } catch {
    return errorRedirect(req, 'userinfo_failed');
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const scopes = tokens.scope ? tokens.scope.split(' ') : payload.intent.scopes;

  // 6. Persistir credentials
  let credentialsId: string;

  if (payload.intent.reuse_credentials_id) {
    // UPDATE: añadir scopes a una credential existente
    const { data: existing } = await supabase
      .from('connector_credentials')
      .select('id, scopes')
      .eq('id', payload.intent.reuse_credentials_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!existing) {
      return errorRedirect(req, 'credentials_not_found');
    }

    // Merge scopes (no perder los existentes)
    const mergedScopes = Array.from(new Set([...(existing.scopes || []), ...scopes]));
    let refreshToken: string | null;
    try {
      refreshToken = await resolveCredentialRefreshToken(
        tokens.refresh_token,
        () => loadDecryptedRefreshTokenById(supabase, existing.id, user.id)
      );
    } catch {
      return errorRedirect(req, 'legacy_credentials_require_migration');
    }

    const { error: updateError } = await supabase
      .from('connector_credentials')
      .update({
        ...encryptCredentialValues({
          access_token: tokens.access_token,
          refresh_token: refreshToken,
        }, existing.id),
        expires_at: expiresAt,
        scopes: mergedScopes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);

    if (updateError) return errorRedirect(req, 'persist_failed');

    credentialsId = existing.id;
  } else {
    // INSERT o UPDATE-if-exists por (user, provider, email)
    const { data: existing } = await supabase
      .from('connector_credentials')
      .select('id, scopes')
      .eq('user_id', user.id)
      .eq('provider', 'google')
      .eq('account_identifier', userinfo.email)
      .maybeSingle();

    if (existing) {
      const mergedScopes = Array.from(
        new Set([...(existing.scopes || []), ...scopes])
      );
      let refreshToken: string | null;
      try {
        refreshToken = await resolveCredentialRefreshToken(
          tokens.refresh_token,
          () => loadDecryptedRefreshTokenById(supabase, existing.id, user.id)
        );
      } catch {
        return errorRedirect(req, 'legacy_credentials_require_migration');
      }
      const { error: updateError } = await supabase
        .from('connector_credentials')
        .update({
          ...encryptCredentialValues({
            access_token: tokens.access_token,
            refresh_token: refreshToken,
          }, existing.id),
          expires_at: expiresAt,
          scopes: mergedScopes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
      if (updateError) return errorRedirect(req, 'persist_failed');
      credentialsId = existing.id;
    } else {
      const newCredentialsId = randomUUID();
      const { data: inserted, error: insErr } = await supabase
        .from('connector_credentials')
        .insert({
          id: newCredentialsId,
          user_id: user.id,
          provider: 'google',
          label: `Google · ${userinfo.email}`,
          account_identifier: userinfo.email,
          ...encryptCredentialValues({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token || null,
          }, newCredentialsId),
          expires_at: expiresAt,
          scopes,
        })
        .select('id')
        .single();

      if (insErr || !inserted) {
        return errorRedirect(req, 'persist_failed');
      }
      credentialsId = inserted.id;
    }
  }

  // 7. Redirigir al `next` con credentials_id en query
  const nextUrl = new URL(payload.intent.next || '/connectors/new', req.url);
  nextUrl.searchParams.set('credentials_id', credentialsId);
  nextUrl.searchParams.set('oauth_success', '1');
  if (payload.intent.connector_name) {
    nextUrl.searchParams.set('connector_name', payload.intent.connector_name);
  }
  if (payload.intent.adapter_type) {
    nextUrl.searchParams.set('adapter_type', payload.intent.adapter_type);
  }

  const res = NextResponse.redirect(nextUrl);
  res.headers.append('Set-Cookie', buildClearCookieHeader());
  return res;
}
