// =====================================================
// OAuth 2.0 con Google
//
// Maneja: build de URL de auth, intercambio code→tokens,
// refresh on-demand, fetch de userinfo (email).
//
// Scopes incremental: cada connector que necesite Google
// declara sus scopes mínimos. Si la credential existente
// no los tiene, se reautentica con todos.
// =====================================================

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;          // solo en el primer intercambio
  expires_in: number;
  token_type: 'Bearer';
  scope: string;                   // espacio-separados
  id_token?: string;
}

export interface GoogleUserInfo {
  email: string;
  verified_email?: boolean;
  picture?: string;
}

function clientId(): string {
  const v = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!v) throw new Error('GOOGLE_OAUTH_CLIENT_ID no configurado');
  return v;
}

function clientSecret(): string {
  const v = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!v) throw new Error('GOOGLE_OAUTH_CLIENT_SECRET no configurado');
  return v;
}

export function redirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base) throw new Error('NEXT_PUBLIC_APP_URL no configurado');
  return `${base.replace(/\/$/, '')}/api/oauth/google/callback`;
}

/**
 * Construye la URL para redirigir al usuario a Google.
 */
export function buildAuthUrl(opts: {
  scopes: string[];
  state: string;
  login_hint?: string;
}): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: opts.scopes.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',                   // fuerza refresh_token
    state: opts.state,
  });
  if (opts.login_hint) params.set('login_hint', opts.login_hint);
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Intercambia el `code` por tokens.
 */
export async function exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Google token exchange failed (${res.status}): ${t}`);
  }
  return await res.json();
}

/**
 * Refresca el access_token usando el refresh_token.
 */
export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Google refresh failed (${res.status}): ${t}`);
  }
  return await res.json();
}

/**
 * Obtiene info del usuario (email principalmente) con un access_token.
 */
export async function fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Google userinfo failed: ${res.status}`);
  }
  return await res.json();
}
