// =====================================================
// Personal Access Tokens — generación y validación
//
// Formato del token plano: pat_<32 chars hex>
//   - 32 chars hex = 128 bits de entropía
//   - prefijo "pat_" identifica el tipo y facilita scan/leak detection
//
// Almacenamiento:
//   - token_hash: SHA-256 hex del plano
//   - token_prefix: primeros 8 chars del plano (incluye "pat_")
//   - token_last_four: últimos 4 chars del plano
//
// Validación:
//   - SHA-256 del incoming, lookup por token_hash
//   - Comprobar revoked_at IS NULL y expires_at > now()
// =====================================================

import { randomBytes, createHash } from 'crypto';

const TOKEN_PREFIX = 'pat_';
const TOKEN_BYTE_LENGTH = 32;       // 32 bytes = 64 hex chars

export interface GeneratedToken {
  plain: string;                    // "pat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  hash: string;                     // SHA-256 hex
  prefix: string;                   // "pat_xxxx"
  last_four: string;
}

export function generateToken(): GeneratedToken {
  const random = randomBytes(TOKEN_BYTE_LENGTH).toString('hex');
  const plain = `${TOKEN_PREFIX}${random}`;
  const hash = hashToken(plain);
  return {
    plain,
    hash,
    prefix: plain.slice(0, 8),
    last_four: plain.slice(-4),
  };
}

export function hashToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

export function isValidTokenFormat(token: string | null | undefined): token is string {
  if (!token) return false;
  if (!token.startsWith(TOKEN_PREFIX)) return false;
  const after = token.slice(TOKEN_PREFIX.length);
  return /^[a-f0-9]{40,}$/i.test(after);
}
