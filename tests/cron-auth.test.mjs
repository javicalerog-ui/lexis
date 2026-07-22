import assert from 'node:assert/strict';
import test from 'node:test';
import { isCronRequestAuthorized } from '../src/lib/security/cron-auth.mjs';

const secret = 'a'.repeat(32);

test('accepts only the documented Bearer contract', () => {
  assert.equal(
    isCronRequestAuthorized(new Headers({ Authorization: `Bearer ${secret}` }), secret),
    true
  );
  assert.equal(
    isCronRequestAuthorized(new Headers({ 'X-CRON-SECRET': secret }), secret),
    false
  );
  assert.equal(
    isCronRequestAuthorized(new Headers({ Authorization: secret }), secret),
    false
  );
});

test('rejects missing, wrong, and weak configured secrets', () => {
  assert.equal(isCronRequestAuthorized(new Headers(), secret), false);
  assert.equal(
    isCronRequestAuthorized(new Headers({ Authorization: `Bearer ${'b'.repeat(32)}` }), secret),
    false
  );
  assert.equal(
    isCronRequestAuthorized(new Headers({ Authorization: 'Bearer short' }), 'short'),
    false
  );
  assert.equal(isCronRequestAuthorized(new Headers({ Authorization: 'Bearer anything' }), ''), false);
});
