// =====================================================
// Tipos del sistema de connectors
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SourceType } from '@/types/domain';

/**
 * Resultado parseado por un adapter para cada item entrante.
 * Después se mapea a IngestionInput y pasa por el pipeline normal.
 */
export interface ConnectorItem {
  external_id: string;           // identificador estable en el sistema origen (msg_id, file_id, etc.)
  content: string;
  source_type: SourceType;
  source_uri?: string;
  captured_at?: string;
  extra_metadata?: Record<string, unknown>;
}

/**
 * Resultado de una ejecución del adapter.
 */
export interface AdapterRunResult {
  items: ConnectorItem[];
  new_state: Record<string, unknown>;
  debug?: Record<string, unknown>;
}

/**
 * Contexto que recibe un adapter al ejecutarse.
 */
export interface AdapterContext {
  /** Config del connector (definido por el usuario al crearlo) */
  config: Record<string, unknown>;

  /** Estado persistido entre runs (cursor, last_id, page_token...) */
  state: Record<string, unknown>;

  /** Credenciales si el connector las requiere */
  credentials: AdapterCredentials | null;

  /** Service client con permisos elevados (para tooling) */
  supabase: SupabaseClient;

  /** ID del usuario dueño */
  user_id: string;

  /** ID del connector que se está ejecutando */
  connector_id: string;
}

export interface AdapterCredentials {
  id: string;
  provider: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  api_key: string | null;
  scopes: string[];
}

/**
 * Definición que cada adapter exporta.
 */
export interface ConnectorAdapter {
  /** Identificador único: 'gmail', 'drive', 'rss', 'webhook'... */
  type: string;

  /** Nombre humano para la UI */
  label: string;

  /** Descripción corta de qué hace */
  description: string;

  /** Glyph del header / icon en la lista */
  glyph: string;

  /** Provider OAuth requerido, o null si no usa */
  oauth_provider: string | null;

  /** Si soporta ejecución programada (pull) */
  supports_schedule: boolean;

  /** Si acepta webhook entrante (push) */
  supports_webhook: boolean;

  /** Validar config jsonb al crear / actualizar */
  validate_config?(config: Record<string, unknown>): { ok: boolean; error?: string };

  /** Ejecutar un pull (si soporta_schedule) */
  run?(ctx: AdapterContext): Promise<AdapterRunResult>;

  /** Procesar payload de webhook (si supports_webhook) */
  handle_webhook?(
    payload: unknown,
    ctx: AdapterContext
  ): Promise<AdapterRunResult>;

  /** Campos del config form (para que la UI genere inputs) */
  config_schema?: ConfigField[];
}

export interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'number' | 'boolean';
  description?: string;
  required?: boolean;
  default?: unknown;
  options?: Array<{ value: string; label: string }>;   // para select
  placeholder?: string;
}
