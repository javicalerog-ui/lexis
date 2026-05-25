// =====================================================
// OAuth state CSRF
//
// El state se firma con HMAC-SHA256 y se envía a Google.
// Además se setea una cookie httpOnly con el mismo valor.
// En el callback validamos: la cookie y el state recibido
// deben coincidir, y la firma debe ser válida.
//
// Payload del state (b64 url-safe):
//   { user_id, nonce, intent: { provider, scopes, next, connector_name } }
// =====================================================

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const COOKIE_NAME = 'lexis_oauth_state';
const COOKIE_MAX_AGE_SECONDS = 600;                   // 10 min

function secret(): string {
  const v = process.env.OAUTH_STATE_SECRET;
  if (!v) throw new Error('OAUTH_STATE_SECRET no configurado');
  return v;
}

function b64url(b: Buffer): string {
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export interface StatePayload {
  user_id: string;
  nonce: string;
  intent: {
    provider: 'google';
    scopes: string[];
    next?: string;                            // path a redirigir tras callback
    connector_name?: string;                  // nombre sugerido del connector a crear
    adapter_type?: string;                    // type del adapter (gmail, drive...) para pre-seleccionar en UI
    reuse_credentials_id?: string;            // si está actualizando una credential existente
  };
}

export function signState(payload: Omit<StatePayload, 'nonce'>): string {
  const fullPayload: StatePayload = {
    ...payload,
    nonce: randomBytes(12).toString('hex'),
  };
  const json = JSON.stringify(fullPayload);
  const body = b64url(Buffer.from(json, 'utf8'));
  const sig = createHmac('sha256', secret()).update(body).digest();
  return `${body}.${b64url(sig)}`;
}

export function verifyState(signed: string): StatePayload | null {
  if (!signed) return null;
  const parts = signed.split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts;

  const expectedSig = createHmac('sha256', secret()).update(body).digest();
  const givenSig = b64urlDecode(signature);
  if (
    expectedSig.length !== givenSig.length ||
    !timingSafeEqual(expectedSig, givenSig)
  ) {
    return null;
  }

  try {
    const json = b64urlDecode(body).toString('utf8');
    return JSON.parse(json) as StatePayload;
  } catch {
    return null;
  }
}

export function buildSetCookieHeader(state: string): string {
  return `${COOKIE_NAME}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_SECONDS}`;
}

export function buildClearCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readStateCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map((c) => c.trim());
  const found = cookies.find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!found) return null;
  return found.substring(COOKIE_NAME.length + 1);
}
