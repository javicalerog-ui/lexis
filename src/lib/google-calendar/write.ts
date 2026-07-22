// =====================================================
// lib/google-calendar/write.ts
//
// Helpers server-side para escribir en Google Calendar.
// Resuelve credentials del user, refresca si hace falta,
// y mantiene el "Lexis · Borradores" como safety net.
//
// Sprint 14.
// =====================================================

import { SupabaseClient } from '@supabase/supabase-js';
import { refreshIfNeeded } from '@/lib/oauth/refresh';
import {
  listCredentialMetadataForUser,
  loadDecryptedCredentialsById,
} from '@/lib/connectors/credentials';
import type { AdapterCredentials } from '@/lib/connectors/types';

const CAL_API = 'https://www.googleapis.com/calendar/v3';
const DRAFT_CAL_SUMMARY = 'Lexis · Borradores';
type FreshGoogleCredentials = AdapterCredentials & { access_token: string };

// ---------- Tipos ----------

export interface GCalEventAttendee {
  email: string;
  displayName?: string;
  responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  optional?: boolean;
}

export interface GCalEventPayload {
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end:   { dateTime?: string; date?: string; timeZone?: string };
  location?: string;
  attendees?: GCalEventAttendee[];
  reminders?: {
    useDefault?: boolean;
    overrides?: Array<{ method: 'email' | 'popup'; minutes: number }>;
  };
  extendedProperties?: {
    shared?: Record<string, string>;
    private?: Record<string, string>;
  };
}

export interface GCalEvent extends GCalEventPayload {
  id: string;
  htmlLink: string;
  status: string;
  created: string;
  updated: string;
  organizer?: { email: string; displayName?: string };
}

// ---------- Resolución de credentials ----------

async function getFreshCredentials(
  supabase: SupabaseClient,
  userId: string
): Promise<FreshGoogleCredentials> {
  // Primero elige por metadatos; no materializa secretos de filas descartadas.
  const metadata = await listCredentialMetadataForUser(supabase, userId, 'google');
  if (metadata.length === 0) {
    throw new Error('no_google_credentials');
  }
  const withCalendar = metadata.find((c) =>
    (c.scopes ?? []).some((s: string) =>
      s.includes('calendar') && !s.includes('readonly')
    )
  );
  if (!withCalendar) {
    throw new Error('no_calendar_scope');
  }
  const decrypted = await loadDecryptedCredentialsById(
    supabase,
    withCalendar.id,
    userId
  );
  if (!decrypted) throw new Error('no_google_credentials');
  const refreshed = await refreshIfNeeded(supabase, decrypted);
  if (!refreshed.access_token) throw new Error('missing_google_access_token');
  return { ...refreshed, access_token: refreshed.access_token };
}

// ---------- Fetch helpers ----------

async function calFetch<T>(
  path: string,
  accessToken: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${CAL_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Calendar API ${path} → ${res.status}: ${t.slice(0, 220)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------- Draft calendar ("Lexis · Borradores") ----------

interface DraftCalendarInfo { id: string; name: string }

export async function ensureDraftCalendar(
  supabase: SupabaseClient,
  userId: string
): Promise<DraftCalendarInfo> {
  // 1. ¿Ya está guardado en user_settings?
  const { data: settings } = await supabase
    .from('user_settings')
    .select('draft_calendar_id')
    .eq('user_id', userId)
    .maybeSingle();

  const creds = await getFreshCredentials(supabase, userId);

  // 2. Si tenemos uno, verificar que sigue existiendo en Google
  if (settings?.draft_calendar_id) {
    try {
      const got = await calFetch<{ id: string; summary: string }>(
        `/calendars/${encodeURIComponent(settings.draft_calendar_id)}`,
        creds.access_token
      );
      return { id: got.id, name: got.summary };
    } catch (e) {
      // Probablemente borrado por el user; recrear abajo
      console.warn('draft calendar missing, recreating', e);
    }
  }

  // 3. Buscar uno existente con el nombre canónico antes de crear duplicado
  const list = await calFetch<{ items?: Array<{ id: string; summary: string }> }>(
    '/users/me/calendarList?fields=items(id,summary)',
    creds.access_token
  );
  const existing = list.items?.find((c) => c.summary === DRAFT_CAL_SUMMARY);
  if (existing) {
    await supabase
      .from('user_settings')
      .upsert({ user_id: userId, draft_calendar_id: existing.id }, { onConflict: 'user_id' });
    return { id: existing.id, name: existing.summary };
  }

  // 4. Crear
  const created = await calFetch<{ id: string; summary: string }>(
    '/calendars',
    creds.access_token,
    {
      method: 'POST',
      body: JSON.stringify({
        summary: DRAFT_CAL_SUMMARY,
        description:
          'Calendario donde Lexis crea eventos en borrador antes de elevarlos al primario. ' +
          'Puedes mover los eventos manualmente cuando los hayas revisado.',
        timeZone: 'Europe/Madrid',
      }),
    }
  );

  // Color tenue (no es crítico si falla)
  try {
    await calFetch(
      `/users/me/calendarList/${encodeURIComponent(created.id)}`,
      creds.access_token,
      {
        method: 'PATCH',
        body: JSON.stringify({ colorId: '5' }),                       // amarillo discreto
      }
    );
  } catch {}

  await supabase
    .from('user_settings')
    .upsert({ user_id: userId, draft_calendar_id: created.id }, { onConflict: 'user_id' });

  return { id: created.id, name: created.summary };
}

// ---------- CRUD eventos ----------

/**
 * Crea un evento en el calendario indicado o en el "Lexis · Borradores"
 * si no se especifica calendarId y el user no ha activado write_to_primary.
 */
export async function createEvent(
  supabase: SupabaseClient,
  userId: string,
  payload: GCalEventPayload,
  options: { calendarId?: string } = {}
): Promise<GCalEvent> {
  const creds = await getFreshCredentials(supabase, userId);

  // Resolver target calendar
  let calendarId = options.calendarId;
  if (!calendarId) {
    const { data: s } = await supabase
      .from('user_settings')
      .select('write_to_primary, draft_calendar_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (s?.write_to_primary) {
      calendarId = 'primary';
    } else {
      const draft = await ensureDraftCalendar(supabase, userId);
      calendarId = draft.id;
    }
  }

  // Marcamos el evento como creado por Lexis (extended properties privadas)
  const fullPayload: GCalEventPayload = {
    ...payload,
    extendedProperties: {
      ...payload.extendedProperties,
      private: {
        created_by_lexis: 'true',
        lexis_created_at: new Date().toISOString(),
        ...(payload.extendedProperties?.private || {}),
      },
    },
  };

  const event = await calFetch<GCalEvent>(
    `/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`,
    creds.access_token,
    {
      method: 'POST',
      body: JSON.stringify(fullPayload),
    }
  );

  return event;
}

export async function updateEvent(
  supabase: SupabaseClient,
  userId: string,
  calendarId: string,
  eventId: string,
  patch: Partial<GCalEventPayload>
): Promise<GCalEvent> {
  const creds = await getFreshCredentials(supabase, userId);
  return calFetch<GCalEvent>(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
    creds.access_token,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }
  );
}

export async function deleteEvent(
  supabase: SupabaseClient,
  userId: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  const creds = await getFreshCredentials(supabase, userId);
  await calFetch(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
    creds.access_token,
    { method: 'DELETE' }
  );
}

// ---------- List calendars (para UI del connector) ----------

export interface CalendarListItem {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  accessRole: string;
  backgroundColor?: string;
  selected?: boolean;
}

export async function listCalendars(
  supabase: SupabaseClient,
  userId: string
): Promise<CalendarListItem[]> {
  const creds = await getFreshCredentials(supabase, userId);
  const res = await calFetch<{ items: CalendarListItem[] }>(
    '/users/me/calendarList?fields=items(id,summary,description,primary,accessRole,backgroundColor,selected)',
    creds.access_token
  );
  return res.items || [];
}
