// =====================================================
// Adapter: webhook genérico
//
// Acepta cualquier POST con payload JSON o texto plano.
// Extrae el contenido de un campo configurable (jsonpath-like)
// y crea una memoria.
//
// Caso de uso: recibir desde Zapier, IFTTT, n8n, formularios web,
// Slack outgoing webhooks, scripts curl, etc.
// =====================================================

import type { ConnectorAdapter, AdapterContext, AdapterRunResult } from '../types';

function extractByPath(obj: any, path: string): unknown {
  if (!path || path === '$' || path === '$.') return obj;
  const parts = path
    .replace(/^\$\.?/, '')
    .split(/\.|\[|\]/)
    .filter(Boolean);
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function tryStringify(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export const webhookAdapter: ConnectorAdapter = {
  type: 'webhook',
  label: 'Webhook entrante',
  description:
    'Recibe POSTs HTTP de cualquier servicio (Zapier, IFTTT, formularios, curl…) y los captura como memoria.',
  glyph: '⇲',
  oauth_provider: null,
  supports_schedule: false,
  supports_webhook: true,

  config_schema: [
    {
      key: 'content_path',
      label: 'Ruta del contenido',
      type: 'text',
      description:
        'JSONPath simple para extraer el texto del payload. Ejemplos: "$.text", "$.body", "$.message.content". Vacío = payload completo.',
      default: '$.content',
      placeholder: '$.content',
    },
    {
      key: 'title_path',
      label: 'Ruta del título (opcional)',
      type: 'text',
      description: 'Si el payload tiene un título, su ruta JSONPath. Se añade como prefijo.',
      default: '',
      placeholder: '$.title',
    },
    {
      key: 'external_id_path',
      label: 'Ruta del ID externo (opcional)',
      type: 'text',
      description: 'Identificador estable del item en el sistema origen. Si está, evita duplicados.',
      default: '$.id',
      placeholder: '$.id',
    },
    {
      key: 'source_type',
      label: 'Tipo de fuente',
      type: 'select',
      description: 'Cómo se etiquetará la memoria capturada.',
      default: 'text',
      options: [
        { value: 'text', label: 'Texto' },
        { value: 'url', label: 'URL' },
        { value: 'md', label: 'Markdown' },
      ],
    },
  ],

  validate_config(config) {
    const contentPath = config.content_path as string | undefined;
    if (contentPath && !contentPath.startsWith('$')) {
      return { ok: false, error: 'content_path debe empezar por "$"' };
    }
    return { ok: true };
  },

  async handle_webhook(payload: any, ctx: AdapterContext): Promise<AdapterRunResult> {
    const cfg = ctx.config;
    const contentPath = (cfg.content_path as string) || '$.content';
    const titlePath = cfg.title_path as string | undefined;
    const externalIdPath = cfg.external_id_path as string | undefined;
    const sourceType = (cfg.source_type as string) || 'text';

    // Si payload es string (no JSON), lo tomamos tal cual
    let content: string;
    let title: string | undefined;
    let externalId: string;

    if (typeof payload === 'string') {
      content = payload;
      externalId = `webhook_${ctx.connector_id}_${Date.now()}`;
    } else if (payload && typeof payload === 'object') {
      const rawContent = extractByPath(payload, contentPath);
      content = tryStringify(rawContent);

      if (titlePath) {
        const t = extractByPath(payload, titlePath);
        if (t) title = tryStringify(t);
      }

      if (externalIdPath) {
        const id = extractByPath(payload, externalIdPath);
        externalId = id
          ? `webhook_${ctx.connector_id}_${tryStringify(id)}`
          : `webhook_${ctx.connector_id}_${Date.now()}`;
      } else {
        externalId = `webhook_${ctx.connector_id}_${Date.now()}`;
      }
    } else {
      throw new Error('Payload vacío o no soportado');
    }

    if (!content.trim()) {
      throw new Error('No se pudo extraer contenido del payload');
    }

    const finalContent = title ? `${title}\n\n${content}` : content;

    return {
      items: [
        {
          external_id: externalId,
          content: finalContent,
          source_type: sourceType as any,
          extra_metadata: {
            webhook_payload_keys:
              payload && typeof payload === 'object' ? Object.keys(payload).slice(0, 20) : null,
            extracted_title: title,
          },
        },
      ],
      new_state: {
        last_received_at: new Date().toISOString(),
      },
    };
  },
};
