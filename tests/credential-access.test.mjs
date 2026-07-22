import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import {
  listCredentialMetadataForUser,
  loadDecryptedCredentialsById,
  loadDecryptedRefreshTokenById,
  resolveCredentialRefreshToken,
} from '../src/lib/connectors/credentials.ts';
import {
  LegacyPlaintextCredentialError,
  encryptCredentialSecret,
} from '../src/lib/security/credential-encryption.mjs';

const credentialId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';

function queryClient(result) {
  const calls = [];
  const query = {
    select(columns) {
      calls.push(['select', columns]);
      return query;
    },
    eq(column, value) {
      calls.push(['eq', column, value]);
      return query;
    },
    order(column, options) {
      calls.push(['order', column, options]);
      return Promise.resolve(result);
    },
    maybeSingle() {
      calls.push(['maybeSingle']);
      return Promise.resolve(result);
    },
  };
  return {
    calls,
    client: {
      from(table) {
        calls.push(['from', table]);
        return query;
      },
    },
  };
}

test('calendar selection lists metadata without materializing credential secrets', async () => {
  const rows = [{
    id: credentialId,
    user_id: userId,
    provider: 'google',
    expires_at: null,
    scopes: ['calendar'],
    account_identifier: 'synthetic@example.invalid',
  }];
  const { client, calls } = queryClient({ data: rows, error: null });

  assert.deepEqual(
    await listCredentialMetadataForUser(client, userId, 'google'),
    rows
  );
  const selectedColumns = calls.find(([method]) => method === 'select')[1];
  assert.doesNotMatch(selectedColumns, /\*|access_token|refresh_token|api_key/u);
});

test('selected credential rows decrypt all secret fields and reject plaintext', async () => {
  const previousKey = process.env.CONNECTOR_CREDENTIALS_ENCRYPTION_KEY;
  const key = randomBytes(32).toString('base64');
  process.env.CONNECTOR_CREDENTIALS_ENCRYPTION_KEY = key;
  try {
    const row = {
      id: credentialId,
      provider: 'google',
      access_token: encryptCredentialSecret('access-value', 'access_token', credentialId, key),
      refresh_token: encryptCredentialSecret('refresh-value', 'refresh_token', credentialId, key),
      expires_at: null,
      api_key: encryptCredentialSecret('api-value', 'api_key', credentialId, key),
      scopes: ['calendar'],
    };
    const encrypted = queryClient({ data: row, error: null });
    const loaded = await loadDecryptedCredentialsById(encrypted.client, credentialId, userId);
    assert.equal(loaded.access_token, 'access-value');
    assert.equal(loaded.refresh_token, 'refresh-value');
    assert.equal(loaded.api_key, 'api-value');
    assert.deepEqual(
      encrypted.calls.filter(([method]) => method === 'eq'),
      [['eq', 'id', credentialId], ['eq', 'user_id', userId]]
    );

    const plaintext = queryClient({ data: { ...row, access_token: 'legacy-plaintext' }, error: null });
    await assert.rejects(
      () => loadDecryptedCredentialsById(plaintext.client, credentialId, userId),
      LegacyPlaintextCredentialError
    );
  } finally {
    if (previousKey === undefined) delete process.env.CONNECTOR_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.CONNECTOR_CREDENTIALS_ENCRYPTION_KEY = previousKey;
  }
});

test('a provider refresh token short-circuits without reading the stored secret', async () => {
  let storedRead = false;
  const resolved = await resolveCredentialRefreshToken('provider-refresh', async () => {
    storedRead = true;
    return 'stored-refresh';
  });
  assert.equal(resolved, 'provider-refresh');
  assert.equal(storedRead, false);
});

test('the fallback branch loads and decrypts the stored refresh token', async () => {
  const previousKey = process.env.CONNECTOR_CREDENTIALS_ENCRYPTION_KEY;
  const key = randomBytes(32).toString('base64');
  process.env.CONNECTOR_CREDENTIALS_ENCRYPTION_KEY = key;
  try {
    const encryptedValue = encryptCredentialSecret(
      'stored-refresh',
      'refresh_token',
      credentialId,
      key
    );
    const encrypted = queryClient({
      data: { id: credentialId, refresh_token: encryptedValue },
      error: null,
    });
    assert.equal(
      await resolveCredentialRefreshToken(
        null,
        () => loadDecryptedRefreshTokenById(encrypted.client, credentialId, userId)
      ),
      'stored-refresh'
    );

    const plaintext = queryClient({
      data: { id: credentialId, refresh_token: 'legacy-plaintext' },
      error: null,
    });
    await assert.rejects(
      () => resolveCredentialRefreshToken(
        null,
        () => loadDecryptedRefreshTokenById(plaintext.client, credentialId, userId)
      ),
      LegacyPlaintextCredentialError
    );
  } finally {
    if (previousKey === undefined) delete process.env.CONNECTOR_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.CONNECTOR_CREDENTIALS_ENCRYPTION_KEY = previousKey;
  }
});
