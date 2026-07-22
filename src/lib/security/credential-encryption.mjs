import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const PREFIX = 'enc:v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ALLOWED_FIELDS = new Set(['access_token', 'refresh_token', 'api_key']);

export class CredentialEncryptionConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CredentialEncryptionConfigurationError';
  }
}

export class LegacyPlaintextCredentialError extends Error {
  constructor() {
    super('Legacy plaintext connector credential rejected; run the credential migration first');
    this.name = 'LegacyPlaintextCredentialError';
  }
}

export class CredentialDecryptionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CredentialDecryptionError';
  }
}

function assertField(field) {
  if (!ALLOWED_FIELDS.has(field)) {
    throw new TypeError('Unsupported connector credential field');
  }
}

function assertBinding(binding) {
  if (typeof binding !== 'string' || binding.length === 0) {
    throw new TypeError('Credential row binding is required');
  }
}

function decodeKey(value, variableName) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CredentialEncryptionConfigurationError(
      `${variableName} is required for connector credentials`
    );
  }

  let key;
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    key = Buffer.from(value, 'hex');
  } else if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) {
    key = Buffer.from(value, value.includes('-') || value.includes('_') ? 'base64url' : 'base64');
  } else {
    throw new CredentialEncryptionConfigurationError(
      `${variableName} must be a 32-byte key encoded as hex or base64`
    );
  }

  if (key.length !== 32) {
    throw new CredentialEncryptionConfigurationError(
      `${variableName} must decode to exactly 32 bytes`
    );
  }
  return key;
}

function keyId(key) {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

function aadFor(field, binding) {
  return Buffer.from(`lexis:connector_credentials:v1:${field}:${binding}`, 'utf8');
}

function primaryKey(value = process.env.CONNECTOR_CREDENTIALS_ENCRYPTION_KEY) {
  const key = decodeKey(value, 'CONNECTOR_CREDENTIALS_ENCRYPTION_KEY');
  return { id: keyId(key), key };
}

function decryptionKeys(options = {}) {
  const primary = primaryKey(options.primaryKey);
  const keys = new Map([[primary.id, primary.key]]);
  const previousValue = options.previousKey ?? process.env.CONNECTOR_CREDENTIALS_PREVIOUS_KEY;
  if (previousValue) {
    const previous = decodeKey(previousValue, 'CONNECTOR_CREDENTIALS_PREVIOUS_KEY');
    keys.set(keyId(previous), previous);
  }
  return { primary, keys };
}

export function assertCredentialEncryptionReady(
  value = process.env.CONNECTOR_CREDENTIALS_ENCRYPTION_KEY
) {
  primaryKey(value);
}

export function isEncryptedCredentialSecret(value) {
  return typeof value === 'string' && value.startsWith(`${PREFIX}:`);
}

export function encryptCredentialSecret(
  value,
  field,
  binding,
  keyValue = process.env.CONNECTOR_CREDENTIALS_ENCRYPTION_KEY
) {
  assertField(field);
  assertBinding(binding);
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new TypeError('Credential secret must be a string or null');

  const { id, key } = primaryKey(keyValue);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aadFor(field, binding));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    PREFIX,
    id,
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    tag.toString('base64url'),
  ].join(':');
}

export function decryptCredentialSecret(value, field, binding, options = {}) {
  assertField(field);
  assertBinding(binding);
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new CredentialDecryptionError('Malformed credential value');
  if (!isEncryptedCredentialSecret(value)) throw new LegacyPlaintextCredentialError();

  const parts = value.split(':');
  if (parts.length !== 6 || parts[0] !== 'enc' || parts[1] !== 'v1') {
    throw new CredentialDecryptionError('Malformed encrypted credential envelope');
  }

  const [, , id, ivPart, ciphertextPart, tagPart] = parts;
  const { keys } = decryptionKeys(options);
  const key = keys.get(id);
  if (!key) {
    throw new CredentialDecryptionError('No configured key can decrypt this credential');
  }

  try {
    const iv = Buffer.from(ivPart, 'base64url');
    const ciphertext = Buffer.from(ciphertextPart, 'base64url');
    const tag = Buffer.from(tagPart, 'base64url');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new Error('invalid envelope lengths');
    }
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aadFor(field, binding));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new CredentialDecryptionError('Credential authentication failed');
  }
}

export function credentialSecretNeedsMigration(
  value,
  keyValue = process.env.CONNECTOR_CREDENTIALS_ENCRYPTION_KEY
) {
  if (value === null || value === undefined) return false;
  if (!isEncryptedCredentialSecret(value)) return true;
  const parts = value.split(':');
  if (parts.length !== 6) throw new CredentialDecryptionError('Malformed encrypted credential envelope');
  return parts[2] !== primaryKey(keyValue).id;
}
