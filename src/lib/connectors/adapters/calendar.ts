// =====================================================
// Adapter: Google Calendar
//
// Sincroniza eventos de los calendarios seleccionados del user
// hacia memorias en Lexis.
//
// Sprint 14. Reutiliza OAuth del Sprint 11 con scope `calendar`.
//
// Estrategia:
//   - Primer run: list events en ventana [now-lookback, now+lookahead]
//     por cada calendar_id seleccionado, captura syncToken al final.
//   - Subsiguientes: list con syncToken (delta). Si Google responde
//     410 Gone (syncToken expirado, ocurre tras varias semanas sin
//     consumo), fallback a primer run.
//   - Eventos cancelados se reflejan como memoria-tombstone (metadata
//     status=cancelled) pero no se borran.
// =====================================================

import type {
  ConnectorAdapter,
  AdapterContext,
  AdapterRunResult,
  ConnectorItem,
} from '../types';

const CAL_API = 'https://www.googleapis.com/calendar/v3';
const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_LOOKAHEAD_DAYS = 90;
const MAX_EVENTS_PER_RUN = 100;

// ---------- Tipos ----------

interface GoogleCalendarEvent {
  id: string;
  status: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink: string;
  created: string;
  updated: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  organizer?: { email: string; displayName?: string };
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: string;
    self?: boolean;
    optional?: boolean;
  }>;
  recurringEventId?: string;
  recurrence?: string[];
  conferenceData?: {
    entryPoints?: Array<{ uri: string; entryPointType: string }>;
  };
  extendedProperties?: {
    private?: Record<string, string>;
    shared?: Record<string, string>;
  };
}

interface EventsListResponse {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

// ---------- Helpers ----------

async function calFetch<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${CAL_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const t = await res.text();
    const err: any = new Error(
      `Calendar API ${path} → ${res.status}: ${t.slice(0, 220)}`
    );
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

function eventStartToTimestamp(ev: GoogleCalendarEvent): string {
  if (ev.start?.dateTime) return ev.start.dateTime;
  if (ev.start?.date) return `${ev.start.date}T00:00:00Z`;
  return ev.created;
}

function eventToContent(ev: GoogleCalendarEvent): string {
  const lines: string[] = [];

  lines.push(`Evento: ${ev.summary || '(sin título)'}`);

  // Fechas
  if (ev.start?.dateTime && ev.end?.dateTime) {
    lines.push(`Inicio: ${ev.start.dateTime}`);
    lines.push(`Fin: ${ev.end.dateTime}`);
  } else if (ev.start?.date) {
    lines.push(`Día: ${ev.start.date}${ev.end?.date && ev.end.date !== ev.start.date ? ` → ${ev.end.date}` : ''} (todo el día)`);
  }

  // Ubicación
  if (ev.location) lines.push(`Lugar: ${ev.location}`);

  // Attendees
  if (ev.attendees && ev.attendees.length > 0) {
    const others = ev.attendees.filter((a) => !a.self);
    if (others.length > 0) {
      const names = others.slice(0, 10).map((a) => a.displayName || a.email);
      lines.push(`Asistentes: ${names.join(', ')}${others.length > 10 ? `, +${others.length - 10}` : ''}`);
    }
  }

  // Organizador (si no soy yo)
  if (ev.organizer && !(ev.attendees?.find((a) => a.self && a.email === ev.organizer?.email))) {
    lines.push(`Organiza: ${ev.organizer.displayName || ev.organizer.email}`);
  }

  // Videoconferencia
  if (ev.conferenceData?.entryPoints) {
    const video = ev.conferenceData.entryPoints.find((e) => e.entryPointType === 'video');
    if (video) lines.push(`Videoconf: ${video.uri}`);
  }

  // Descripción al final
  if (ev.description) {
    lines.push('');
    // Strip HTML básico (Google Calendar a veces lo manda)
    const stripped = ev.description
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .trim();
    if (stripped) lines.push(stripped);
  }

  return lines.join('\n');
}

function eventToMemory(
  ev: GoogleCalendarEvent,
  calendarId: string,
  calendarSummary: string
): ConnectorItem {
  const startTs = eventStartToTimestamp(ev);

  return {
    external_id: `gcal_${calendarId}_${ev.id}`,
    content: eventToContent(ev),
    source_type: 'text',
    source_uri: ev.htmlLink,
    captured_at: startTs,                              // ancla la memoria al inicio del evento, no al created
    extra_metadata: {
      gcal_event_id: ev.id,
      gcal_calendar_id: calendarId,
      gcal_calendar_summary: calendarSummary,
      gcal_status: ev.status,
      gcal_start: ev.start,
      gcal_end: ev.end,
      gcal_location: ev.location,
      gcal_attendees: ev.attendees?.map((a) => ({
        email: a.email,
        name: a.displayName,
        self: a.self,
        response: a.responseStatus,
      })),
      gcal_organizer: ev.organizer,
      gcal_html_link: ev.htmlLink,
      gcal_recurring_event_id: ev.recurringEventId,
      gcal_has_video: !!ev.conferenceData?.entryPoints?.some(
        (e) => e.entryPointType === 'video'
      ),
      gcal_created_by_lexis: ev.extendedProperties?.private?.created_by_lexis === 'true',
      gcal_event_role:
        ev.attendees?.find((a) => a.self)?.responseStatus ?? 'unknown',
    },
  };
}

// ---------- Adapter ----------

export const calendarAdapter: ConnectorAdapter = {
  type: 'calendar',
  label: 'Google Calendar',
  description:
    'Captura tus eventos de Google Calendar como memorias y permite a Lexis crear/modificar eventos cuando le pides. Soporta calendarios múltiples.',
  glyph: '◷',
  oauth_provider: 'google',
  supports_schedule: true,
  supports_webhook: false,

  config_schema: [
    {
      key: 'calendar_ids',
      label: 'IDs de calendarios a sincronizar',
      type: 'textarea',
      description:
        'Lista de IDs de calendar (uno por línea). Si lo dejas vacío usa solo "primary". Para ver los IDs disponibles, ve a /api/credentials/google/calendars tras autorizar.',
      placeholder: 'primary\nlexis-borradores@group.calendar.google.com',
      default: 'primary',
    },
    {
      key: 'lookback_days',
      label: 'Días hacia atrás a capturar en primer run',
      type: 'number',
      description: 'Cuántos días pasados sincronizar al arrancar. Después solo deltas.',
      default: DEFAULT_LOOKBACK_DAYS,
    },
    {
      key: 'lookahead_days',
      label: 'Días hacia adelante a capturar',
      type: 'number',
      description: 'Horizonte futuro de eventos a sincronizar. Eventos más lejanos llegarán en siguientes runs.',
      default: DEFAULT_LOOKAHEAD_DAYS,
    },
    {
      key: 'include_declined',
      label: 'Incluir eventos rechazados',
      type: 'boolean',
      description: 'Si activo, captura también eventos a los que has dicho "no". Por defecto los descarta.',
      default: false,
    },
  ],

  validate_config(config) {
    const ids = (config.calendar_ids as string)?.split('\n').map((s) => s.trim()).filter(Boolean) || ['primary'];
    if (ids.length === 0) return { ok: false, error: 'Al menos un calendar_id requerido.' };
    return { ok: true };
  },

  async run(ctx: AdapterContext): Promise<AdapterRunResult> {
    if (!ctx.credentials?.access_token) {
      throw new Error('Falta access_token. Reautoriza la cuenta de Google con scope calendar.');
    }
    const accessToken = ctx.credentials.access_token;

    const calendarIds = ((ctx.config.calendar_ids as string) || 'primary')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    const lookbackDays = (ctx.config.lookback_days as number) || DEFAULT_LOOKBACK_DAYS;
    const lookaheadDays = (ctx.config.lookahead_days as number) || DEFAULT_LOOKAHEAD_DAYS;
    const includeDeclined = (ctx.config.include_declined as boolean) ?? false;

    // El state guarda { sync_tokens: { calId: token, ... } }
    const stateSyncTokens =
      (ctx.state.sync_tokens as Record<string, string> | undefined) ?? {};
    const newSyncTokens: Record<string, string> = { ...stateSyncTokens };

    const allItems: ConnectorItem[] = [];
    const debug: Record<string, any> = { per_calendar: {} };

    for (const calendarId of calendarIds) {
      const perCal: any = {};
      let pageToken: string | undefined;
      let syncToken = stateSyncTokens[calendarId];
      let eventsCount = 0;
      let calendarSummary = calendarId;

      // Obtener summary del calendario (para metadata)
      try {
        const cal = await calFetch<{ summary: string }>(
          `/calendars/${encodeURIComponent(calendarId)}?fields=summary`,
          accessToken
        );
        calendarSummary = cal.summary || calendarId;
      } catch {}

      try {
        do {
          const params = new URLSearchParams({
            singleEvents: 'true',                     // expande recurrentes en instancias
            showDeleted: 'true',
            maxResults: '250',
          });

          if (syncToken) {
            // Modo incremental: ignora timeMin/timeMax (no se pueden mezclar con syncToken)
            params.set('syncToken', syncToken);
          } else {
            // Primer run
            const now = Date.now();
            params.set('timeMin', new Date(now - lookbackDays * 86400_000).toISOString());
            params.set('timeMax', new Date(now + lookaheadDays * 86400_000).toISOString());
            params.set('orderBy', 'startTime');
          }
          if (pageToken) params.set('pageToken', pageToken);

          const res: EventsListResponse = await calFetch(
            `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
            accessToken
          );

          for (const ev of res.items || []) {
            if (eventsCount >= MAX_EVENTS_PER_RUN) break;

            // Filtros
            if (ev.status === 'cancelled' && !syncToken) continue;          // primer run: skip cancelados ancestrales
            if (!includeDeclined) {
              const me = ev.attendees?.find((a) => a.self);
              if (me?.responseStatus === 'declined') continue;
            }
            if (!ev.summary && !ev.description) continue;                   // eventos vacíos

            allItems.push(eventToMemory(ev, calendarId, calendarSummary));
            eventsCount++;
          }

          pageToken = res.nextPageToken;
          // El syncToken solo aparece en la ÚLTIMA página
          if (res.nextSyncToken) {
            newSyncTokens[calendarId] = res.nextSyncToken;
          }
        } while (pageToken && eventsCount < MAX_EVENTS_PER_RUN);

        perCal.mode = syncToken ? 'incremental' : 'first_run';
        perCal.events = eventsCount;
      } catch (e: any) {
        // 410 Gone → syncToken caducado, forzar primer run en siguiente ejecución
        if (e.status === 410) {
          delete newSyncTokens[calendarId];
          perCal.error = 'sync_token_expired';
        } else {
          perCal.error = String(e).slice(0, 200);
        }
      }

      debug.per_calendar[calendarId] = perCal;
    }

    return {
      items: allItems,
      new_state: {
        sync_tokens: newSyncTokens,
        last_run_at: new Date().toISOString(),
        calendar_ids_resolved: calendarIds,
      },
      debug,
    };
  },
};
