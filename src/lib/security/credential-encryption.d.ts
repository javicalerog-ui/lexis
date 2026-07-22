export type CredentialSecretField = 'access_token' | 'refresh_token' | 'api_key';

export class CredentialEncryptionConfigurationError extends Error {}
export class LegacyPlaintextCredentialError extends Error {}
export class CredentialDecryptionError extends Error {}

export function assertCredentialEncryptionReady(keyValue?: string): void;
export function isEncryptedCredentialSecret(value: unknown): value is string;
export function encryptCredentialSecret(
  value: string | null | undefined,
  field: CredentialSecretField,
  binding: string,
  keyValue?: string
): string | null;
export function decryptCredentialSecret(
  value: string | null | undefined,
  field: CredentialSecretField,
  binding: string,
  options?: { primaryKey?: string; previousKey?: string }
): string | null;
export function credentialSecretNeedsMigration(
  value: string | null | undefined,
  keyValue?: string
): boolean;
