// =====================================================
// Adapter: Gmail
//
// Estrategia:
//   - Primer run (sin state.last_history_id):
//     listar mensajes con query/labels, capturar primeros N,
//     guardar el historyId más alto visto como cursor.
//   - Runs subsiguientes:
//     usar Gmail History API desde state.last_history_id para
//     obtener cambios. Si Google devuelve "historyId too old"
//     (>1 semana sin pollear, ~404), reset al modo "primer run"
//     con un query date-filtered para no re-importar todo.
//
// Mapeo:
//   - external_id = "gmail_<message_id>"
//   - subject como título, cuerpo plain text (fallback HTML stripped)
//   - source_type = 'text'
//   - metadata: from, to, thread_id, subject, labels, snippet, date
//
// Adjuntos: detectados pero NO procesados todavía (Sprint dedicado).
// =====================================================

import type {
  ConnectorAdapter,
  AdapterContext,
  AdapterRunResult,
  ConnectorItem,
} from '../types';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const MAX_ITEMS_PER_RUN = 50;
const FIRST_RUN_MAX_AGE_DAYS = 14;          // primer poll: no traer más viejo que esto

// ============ Tipos de la API ============

interface GmailMessage {
  id: string;
  threadId: string;
  historyId: string;
  labelIds: string[];
  snippet: string;
  internalDate: string;          // milisegundos como string
  payload: GmailPayload;
}

interface GmailPayload {
  headers: Array<{ name: string; value: string }>;
  mimeType: string;
  body?: { data?: string; size: number };
  parts?: GmailPayload[];
  filename?: string;
}

interface GmailListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate: number;
}

interface GmailProfile {
  emailAddress: string;
  historyId: string;
  messagesTotal: number;
  threadsTotal: number;
}

interface GmailHistoryResponse {
  history?: Array<{
    id: string;
    messages?: Array<{ id: string; threadId: string }>;
    messagesAdded?: Array<{ message: { id: string; threadId: string; labelIds?: string[] } }>;
  }>;
  nextPageToken?: string;
  historyId: string;
}

// ============ Helpers ============

function b64urlDecodeToString(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString(
    'utf8'
  );
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractBody(payload: GmailPayload): { text: string; has_attachments: boolean } {
  let textBody = '';
  let htmlBody = '';
  let hasAttachments = false;

  function walk(p: GmailPayload) {
    if (p.filename && p.filename.length > 0) {
      hasAttachments = true;
    }
    if (p.mimeType === 'text/plain' && p.body?.data && !textBody) {
      textBody = b64urlDecodeToString(p.body.data);
    } else if (p.mimeType === 'text/html' && p.body?.data && !htmlBody) {
      htmlBody = b64urlDecodeToString(p.body.data);
    }
    if (p.parts) {
      for (const part of p.parts) walk(part);
    }
  }
  walk(payload);

  const text = textBody.trim() || (htmlBody ? stripHtml(htmlBody) : '');
  return { text, has_attachments: hasAttachments };
}

function getHeader(payload: GmailPayload, name: string): string {
  const h = payload.headers?.find(
    (x) => x.name.toLowerCase() === name.toLowerCase()
  );
  return h?.value || '';
}

async function gmailFetch<T>(
  path: string,
  accessToken: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${GMAIL_API}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gmail API ${path} → ${res.status}: ${t.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

async function getMessage(id: string, accessToken: string): Promise<GmailMessage> {
  return gmailFetch<GmailMessage>(
    `/messages/${id}?format=full`,
    accessToken
  );
}

function messageToItem(
  msg: GmailMessage,
  connectorId: string,
  connectorName: string
): ConnectorItem {
  const subject = getHeader(msg.payload, 'Subject') || '(sin asunto)';
  const from = getHeader(msg.payload, 'From');
  const to = getHeader(msg.payload, 'To');
  const date = getHeader(msg.payload, 'Date');

  const { text, has_attachments } = extractBody(msg.payload);

  const content = `Asunto: ${subject}\nDe: ${from}\n\n${text || msg.snippet}`;

  const internalDateMs = parseInt(msg.internalDate);
  const capturedAt = !Number.isNaN(internalDateMs)
    ? new Date(internalDateMs).toISOString()
    : undefined;

  return {
    external_id: `gmail_${msg.id}`,
    content: content.slice(0, 40_000),       // protegerse de mensajes gigantes
    source_type: 'text',
    source_uri: `https://mail.google.com/mail/u/0/#all/${msg.id}`,
    captured_at: capturedAt,
    extra_metadata: {
      gmail_message_id: msg.id,
      gmail_thread_id: msg.threadId,
      gmail_label_ids: msg.labelIds,
      subject,
      from,
      to,
      date_header: date,
      snippet: msg.snippet,
      has_attachments,
      connector_name: connectorName,
    },
  };
}

// ============ Adapter ============

export const gmailAdapter: ConnectorAdapter = {
  type: 'gmail',
  label: 'Gmail',
  description:
    'Polea mensajes de Gmail que coincidan con un filtro y los captura como memorias. Sincronización incremental vía History API.',
  glyph: '✉',
  oauth_provider: 'google',
  supports_schedule: true,
  supports_webhook: false,

  config_schema: [
    {
      key: 'query',
      label: 'Gmail search query',
      type: 'text',
      description:
        'Sintaxis estándar de Gmail. Ejemplos: "label:lexis-inbox", "from:cliente.com", "is:starred newer_than:7d".',
      required: true,
      default: 'label:lexis-inbox',
      placeholder: 'label:lexis-inbox',
    },
    {
      key: 'max_per_run',
      label: 'Máximo de mensajes por ejecución',
      type: 'number',
      description: 'Tope por run para no saturar al primer poll de bandejas grandes.',
      default: 25,
    },
    {
      key: 'include_attachments',
      label: 'Marcar mensajes con adjuntos',
      type: 'boolean',
      description:
        'Sprint 11 no procesa adjuntos, pero los detecta. Sí = añade flag has_attachments en la memoria.',
      default: true,
    },
  ],

  validate_config(config) {
    const query = config.query as string;
    if (!query || !query.trim()) {
      return { ok: false, error: 'query no puede estar vacío' };
    }
    return { ok: true };
  },

  async run(ctx: AdapterContext): Promise<AdapterRunResult> {
    if (!ctx.credentials?.access_token) {
      throw new Error('Falta access_token. Reautoriza la cuenta de Google.');
    }
    const accessToken = ctx.credentials.access_token;
    const query = ctx.config.query as string;
    const maxPerRun = Math.min(
      (ctx.config.max_per_run as number) || 25,
      MAX_ITEMS_PER_RUN
    );

    const lastHistoryId = (ctx.state.last_history_id as string) || null;
    const items: ConnectorItem[] = [];
    const messageIds = new Set<string>();
    const debug: Record<string, unknown> = {};

    // Estrategia 1: incremental con History API
    if (lastHistoryId) {
      try {
        let pageToken: string | undefined;
        let historyCalls = 0;
        do {
          const params = new URLSearchParams({
            startHistoryId: lastHistoryId,
            historyTypes: 'messageAdded',
          });
          if (pageToken) params.set('pageToken', pageToken);
          const data: GmailHistoryResponse = await gmailFetch(
            `/history?${params.toString()}`,
            accessToken
          );
          historyCalls++;

          for (const h of data.history || []) {
            for (const ma of h.messagesAdded || []) {
              messageIds.add(ma.message.id);
            }
          }
          pageToken = data.nextPageToken;
        } while (pageToken && messageIds.size < maxPerRun && historyCalls < 5);

        debug.mode = 'incremental';
        debug.history_calls = historyCalls;
      } catch (e: any) {
        const msg = String(e);
        // historyId demasiado viejo → fallback a list
        if (msg.includes('404') || msg.includes('410')) {
          debug.fallback_reason = 'history_too_old';
        } else {
          throw e;
        }
      }
    }

    // Estrategia 2: list por query (primer run o fallback)
    if (!lastHistoryId || debug.fallback_reason) {
      const params = new URLSearchParams({
        q: lastHistoryId
          ? query                                 // fallback: solo el query del user
          : `${query} newer_than:${FIRST_RUN_MAX_AGE_DAYS}d`,  // primer run: añadir filtro fecha
        maxResults: String(maxPerRun),
      });
      const list: GmailListResponse = await gmailFetch(
        `/messages?${params.toString()}`,
        accessToken
      );
      for (const m of list.messages || []) {
        messageIds.add(m.id);
      }
      if (!lastHistoryId) debug.mode = 'first_run';
    }

    // Cargar cada mensaje (cap aplicado)
    const idsToFetch = Array.from(messageIds).slice(0, maxPerRun);
    let maxHistoryId = lastHistoryId ? parseInt(lastHistoryId) : 0;

    for (const id of idsToFetch) {
      try {
        const msg = await getMessage(id, accessToken);
        items.push(messageToItem(msg, ctx.connector_id, 'gmail'));
        const hid = parseInt(msg.historyId);
        if (!Number.isNaN(hid) && hid > maxHistoryId) maxHistoryId = hid;
      } catch (e) {
        console.error(`Gmail: error fetching message ${id}`, e);
      }
    }

    // Si no procesamos nada y no había last_history_id, obtener uno actual
    if (maxHistoryId === 0) {
      try {
        const profile: GmailProfile = await gmailFetch('/profile', accessToken);
        maxHistoryId = parseInt(profile.historyId) || 0;
        debug.profile_history_id = maxHistoryId;
      } catch (e) {
        // ignorar
      }
    }

    return {
      items,
      new_state: {
        last_history_id: maxHistoryId > 0 ? String(maxHistoryId) : lastHistoryId,
        last_run_at: new Date().toISOString(),
        query,
      },
      debug: {
        ...debug,
        ids_total: idsToFetch.length,
      },
    };
  },
};
