import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import {
  CredentialDecryptionError,
  CredentialEncryptionConfigurationError,
  LegacyPlaintextCredentialError,
  credentialSecretNeedsMigration,
  decryptCredentialSecret,
  encryptCredentialSecret,
} from '../src/lib/security/credential-encryption.mjs';

const key = () => randomBytes(32).toString('base64');
const credentialId = '11111111-1111-4111-8111-111111111111';

test('round-trips every supported secret field without deterministic ciphertext', () => {
  const primary = key();
  for (const field of ['access_token', 'refresh_token', 'api_key']) {
    const first = encryptCredentialSecret('sensitive-value', field, credentialId, primary);
    const second = encryptCredentialSecret('sensitive-value', field, credentialId, primary);
    assert.notEqual(first, second);
    assert.equal(
      decryptCredentialSecret(first, field, credentialId, { primaryKey: primary }),
      'sensitive-value'
    );
  }
});

test('binds ciphertext to its database field', () => {
  const primary = key();
  const encrypted = encryptCredentialSecret('sensitive-value', 'access_token', credentialId, primary);
  assert.throws(
    () => decryptCredentialSecret(encrypted, 'refresh_token', credentialId, { primaryKey: primary }),
    CredentialDecryptionError
  );
});

test('binds ciphertext to its credential row', () => {
  const primary = key();
  const encrypted = encryptCredentialSecret('sensitive-value', 'access_token', credentialId, primary);
  assert.throws(
    () => decryptCredentialSecret(
      encrypted,
      'access_token',
      '22222222-2222-4222-8222-222222222222',
      { primaryKey: primary }
    ),
    CredentialDecryptionError
  );
});

test('rejects plaintext and missing or invalid keys fail closed', () => {
  assert.throws(
    () => decryptCredentialSecret('legacy-plaintext', 'access_token', credentialId, { primaryKey: key() }),
    LegacyPlaintextCredentialError
  );
  assert.throws(
    () => encryptCredentialSecret('value', 'access_token', credentialId, ''),
    CredentialEncryptionConfigurationError
  );
  assert.throws(
    () => encryptCredentialSecret('value', 'access_token', credentialId, 'too-short'),
    CredentialEncryptionConfigurationError
  );
});

test('detects tampering', () => {
  const primary = key();
  const encrypted = encryptCredentialSecret('sensitive-value', 'access_token', credentialId, primary);
  const parts = encrypted.split(':');
  const tag = Buffer.from(parts[5], 'base64url');
  tag[0] ^= 1;
  parts[5] = tag.toString('base64url');
  const tampered = parts.join(':');
  assert.throws(
    () => decryptCredentialSecret(tampered, 'access_token', credentialId, { primaryKey: primary }),
    CredentialDecryptionError
  );
});

test('supports a bounded previous-key rotation window', () => {
  const previous = key();
  const primary = key();
  const encrypted = encryptCredentialSecret('sensitive-value', 'api_key', credentialId, previous);
  assert.equal(
    decryptCredentialSecret(encrypted, 'api_key', credentialId, {
      primaryKey: primary,
      previousKey: previous,
    }),
    'sensitive-value'
  );
  assert.equal(credentialSecretNeedsMigration(encrypted, primary), true);
});

test('preserves null fields', () => {
  const primary = key();
  assert.equal(encryptCredentialSecret(null, 'api_key', credentialId, primary), null);
  assert.equal(
    decryptCredentialSecret(null, 'api_key', credentialId, { primaryKey: primary }),
    null
  );
  assert.equal(credentialSecretNeedsMigration(null, primary), false);
});
