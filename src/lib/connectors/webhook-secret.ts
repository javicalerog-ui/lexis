// =====================================================
// Webhook secrets para connectors que aceptan inbound.
//
// Formato: whk_<32 chars hex>
// Almacenamiento: solo el SHA-256. Se muestra al user una vez.
// =====================================================

import { randomBytes, createHash } from 'crypto';

const PREFIX = 'whk_';

export interface GeneratedWebhookSecret {
  plain: string;
  hash: string;
  prefix: string;
}

export function generateWebhookSecret(): GeneratedWebhookSecret {
  const random = randomBytes(20).toString('hex');
  const plain = `${PREFIX}${random}`;
  const hash = createHash('sha256').update(plain).digest('hex');
  return {
    plain,
    hash,
    prefix: plain.slice(0, 8),
  };
}

export function hashWebhookSecret(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}
