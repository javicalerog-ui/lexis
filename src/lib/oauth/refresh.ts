// =====================================================
// Refresh on-demand de credentials.
//
// Llamado por los adapters antes de hacer requests. Si el
// access_token expira en menos del margen, lo refresca y
// persiste el nuevo.
//
// Diseñado para ser thread-safe a nivel de instance del runner
// (que es secuencial). Si dos runs concurrentes refrescaran el
// mismo credential, el último write gana — es aceptable.
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdapterCredentials } from '@/lib/connectors/types';
import { encryptCredentialValues } from '@/lib/connectors/credentials';
import { refreshAccessToken } from './google';

const EXPIRY_MARGIN_MS = 5 * 60 * 1000;       // refrescar si quedan <5min

export async function refreshIfNeeded(
  supabase: SupabaseClient,
  credentials: AdapterCredentials
): Promise<AdapterCredentials> {
  if (!credentials.refresh_token) {
    // No hay refresh token (api_key based o legacy) — devolver tal cual
    return credentials;
  }

  // Si no tenemos expires_at o ya pasó (con margen), refrescar
  const expiresAt = credentials.expires_at
    ? new Date(credentials.expires_at).getTime()
    : 0;
  const now = Date.now();

  if (expiresAt - now > EXPIRY_MARGIN_MS) {
    return credentials;          // todavía válido
  }

  // Refresh contra el provider correcto
  if (credentials.provider !== 'google') {
    // Sprint 11: solo google soportado. Futuro: switch por provider.
    throw new Error(`Provider sin refresh implementado: ${credentials.provider}`);
  }

  const fresh = await refreshAccessToken(credentials.refresh_token);
  const newExpiresAt = new Date(now + fresh.expires_in * 1000).toISOString();

  // Persistir (refresh_token a veces NO viene en la respuesta; mantener el viejo si no)
  const newRefresh = fresh.refresh_token || credentials.refresh_token;
  const newScopes = fresh.scope ? fresh.scope.split(' ') : credentials.scopes;

  const { error: persistError } = await supabase
    .from('connector_credentials')
    .update({
      ...encryptCredentialValues({
        access_token: fresh.access_token,
        refresh_token: newRefresh,
      }, credentials.id),
      expires_at: newExpiresAt,
      scopes: newScopes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', credentials.id);

  if (persistError) {
    throw new Error('credential_refresh_persist_failed');
  }

  return {
    ...credentials,
    access_token: fresh.access_token,
    refresh_token: newRefresh,
    expires_at: newExpiresAt,
    scopes: newScopes,
  };
}
