import { timingSafeEqual } from 'node:crypto';

const MIN_SECRET_BYTES = 32;

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

/** Canonical cron contract: Authorization: Bearer <CRON_SECRET>. */
export function isCronRequestAuthorized(
  headers,
  secret = process.env.CRON_SECRET
) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < MIN_SECRET_BYTES) {
    return false;
  }
  const authorization = headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return false;
  return safeEqual(authorization, `Bearer ${secret}`);
}
