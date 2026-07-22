#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import {
  assertCredentialEncryptionReady,
  credentialSecretNeedsMigration,
  decryptCredentialSecret,
  encryptCredentialSecret,
  isEncryptedCredentialSecret,
} from '../src/lib/security/credential-encryption.mjs';

const APPLY = process.argv.includes('--apply');
const FIELDS = ['access_token', 'refresh_token', 'api_key'];

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function migrateValue(value, field, credentialId) {
  if (value === null || value === undefined) return { value, changed: false };
  if (!credentialSecretNeedsMigration(value)) {
    // Authentication check: a primary-key envelope must still be decryptable.
    decryptCredentialSecret(value, field, credentialId);
    return { value, changed: false };
  }

  const plaintext = isEncryptedCredentialSecret(value)
    ? decryptCredentialSecret(value, field, credentialId)
    : value;
  return {
    value: encryptCredentialSecret(plaintext, field, credentialId),
    changed: true,
  };
}

async function main() {
  const url = requiredEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  requiredEnv('CONNECTOR_CREDENTIALS_ENCRYPTION_KEY');
  assertCredentialEncryptionReady();

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: rows, error } = await supabase
    .from('connector_credentials')
    .select('id, access_token, refresh_token, api_key')
    .order('id');
  if (error) throw new Error(`Could not read connector credentials: ${error.message}`);

  // Preflight every value before changing any row. No secret values are printed.
  const plan = (rows ?? []).map((row) => {
    const update = {};
    let changedFields = 0;
    for (const field of FIELDS) {
      const migrated = migrateValue(row[field], field, row.id);
      if (migrated.changed) {
        update[field] = migrated.value;
        changedFields += 1;
      }
    }
    return { id: row.id, update, changedFields };
  });

  const rowsToChange = plan.filter((item) => item.changedFields > 0);
  const fieldsToChange = rowsToChange.reduce((sum, item) => sum + item.changedFields, 0);
  console.log(`Credential rows scanned: ${plan.length}`);
  console.log(`Rows requiring migration: ${rowsToChange.length}`);
  console.log(`Secret fields requiring migration: ${fieldsToChange}`);

  if (!APPLY) {
    console.log('Dry run only. Re-run with --apply during the documented maintenance window.');
    return;
  }

  for (const item of rowsToChange) {
    const { error: updateError } = await supabase
      .from('connector_credentials')
      .update({ ...item.update, updated_at: new Date().toISOString() })
      .eq('id', item.id);
    if (updateError) throw new Error(`Credential migration update failed: ${updateError.message}`);
  }

  console.log(`Rows migrated: ${rowsToChange.length}`);
  console.log('Re-run without --apply and require "Rows requiring migration: 0" before re-enabling connectors.');
}

main().catch((error) => {
  console.error(`Credential migration aborted: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
});
