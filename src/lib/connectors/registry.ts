// =====================================================
// Registry de adapters
//
// Cuando se añade un connector nuevo, se registra aquí.
// El dispatcher y la UI usan este registry para descubrir
// los tipos disponibles.
// =====================================================

import type { ConnectorAdapter } from './types';
import { webhookAdapter } from './adapters/webhook';
import { rssAdapter } from './adapters/rss';
import { gmailAdapter } from './adapters/gmail';
import { driveAdapter } from './adapters/drive';
import { calendarAdapter } from './adapters/calendar';

const ADAPTERS: ConnectorAdapter[] = [
  webhookAdapter,
  rssAdapter,
  gmailAdapter,
  driveAdapter,
  calendarAdapter,
];

const ADAPTERS_BY_TYPE: Record<string, ConnectorAdapter> = Object.fromEntries(
  ADAPTERS.map((a) => [a.type, a])
);

export function listAdapters(): ConnectorAdapter[] {
  return ADAPTERS;
}

export function getAdapter(type: string): ConnectorAdapter | null {
  return ADAPTERS_BY_TYPE[type] ?? null;
}

/**
 * Versión pública del adapter (sin las funciones), para enviar al cliente.
 */
export interface PublicAdapterInfo {
  type: string;
  label: string;
  description: string;
  glyph: string;
  oauth_provider: string | null;
  supports_schedule: boolean;
  supports_webhook: boolean;
  config_schema?: ConnectorAdapter['config_schema'];
}

export function publicAdapterInfo(a: ConnectorAdapter): PublicAdapterInfo {
  return {
    type: a.type,
    label: a.label,
    description: a.description,
    glyph: a.glyph,
    oauth_provider: a.oauth_provider,
    supports_schedule: a.supports_schedule,
    supports_webhook: a.supports_webhook,
    config_schema: a.config_schema,
  };
}
