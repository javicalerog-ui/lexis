import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdapterCredentials } from './types';
import {
  decryptCredentialSecret,
  encryptCredentialSecret,
} from '../security/credential-encryption.mjs';

const CREDENTIAL_METADATA_COLUMNS =
  'id, user_id, provider, expires_at, scopes, account_identifier';
const STORED_CREDENTIAL_COLUMNS =
  'id, provider, access_token, refresh_token, expires_at, api_key, scopes';

export interface StoredAdapterCredentials {
  id: string;
  provider: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  api_key: string | null;
  scopes: string[] | null;
}

export interface CredentialMetadata {
  id: string;
  user_id: string;
  provider: string;
  expires_at: string | null;
  scopes: string[] | null;
  account_identifier: string | null;
}

export class CredentialStoreReadError extends Error {
  constructor() {
    super('connector_credential_read_failed');
    this.name = 'CredentialStoreReadError';
  }
}

/** Convert a database row into the short-lived plaintext shape adapters need. */
export function decryptStoredCredentials(
  row: StoredAdapterCredentials
): AdapterCredentials {
  return {
    id: row.id,
    provider: row.provider,
    access_token: decryptCredentialSecret(row.access_token, 'access_token', row.id),
    refresh_token: decryptCredentialSecret(row.refresh_token, 'refresh_token', row.id),
    expires_at: row.expires_at,
    api_key: decryptCredentialSecret(row.api_key, 'api_key', row.id),
    scopes: row.scopes ?? [],
  };
}

/** Encrypt credential fields immediately before persistence. */
export function encryptCredentialValues(values: {
  access_token?: string | null;
  refresh_token?: string | null;
  api_key?: string | null;
}, credentialId: string) {
  const encrypted: Record<string, string | null> = {};
  if ('access_token' in values) {
    encrypted.access_token = encryptCredentialSecret(values.access_token, 'access_token', credentialId);
  }
  if ('refresh_token' in values) {
    encrypted.refresh_token = encryptCredentialSecret(values.refresh_token, 'refresh_token', credentialId);
  }
  if ('api_key' in values) {
    encrypted.api_key = encryptCredentialSecret(values.api_key, 'api_key', credentialId);
  }
  return encrypted;
}

/** List only non-secret fields so callers can choose one row safely. */
export async function listCredentialMetadataForUser(
  supabase: SupabaseClient,
  userId: string,
  provider: string
): Promise<CredentialMetadata[]> {
  const { data, error } = await supabase
    .from('connector_credentials')
    .select(CREDENTIAL_METADATA_COLUMNS)
    .eq('user_id', userId)
    .eq('provider', provider)
    .order('updated_at', { ascending: false });

  if (error) throw new CredentialStoreReadError();
  return (data ?? []) as CredentialMetadata[];
}

/** Fetch and decrypt exactly one selected credential row. */
export async function loadDecryptedCredentialsById(
  supabase: SupabaseClient,
  credentialId: string,
  userId: string
): Promise<AdapterCredentials | null> {
  const { data, error } = await supabase
    .from('connector_credentials')
    .select(STORED_CREDENTIAL_COLUMNS)
    .eq('id', credentialId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new CredentialStoreReadError();
  if (!data) return null;
  return decryptStoredCredentials(data as StoredAdapterCredentials);
}

/** Load a stored refresh token only on branches that actually need it. */
export async function loadDecryptedRefreshTokenById(
  supabase: SupabaseClient,
  credentialId: string,
  userId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('connector_credentials')
    .select('id, refresh_token')
    .eq('id', credentialId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) throw new CredentialStoreReadError();
  return decryptCredentialSecret(data.refresh_token, 'refresh_token', data.id);
}

/** Prefer a provider-issued token without loading the stored secret. */
export async function resolveCredentialRefreshToken(
  providerRefreshToken: string | null | undefined,
  loadStoredRefreshToken: () => Promise<string | null>
): Promise<string | null> {
  if (providerRefreshToken) return providerRefreshToken;
  return loadStoredRefreshToken();
}
