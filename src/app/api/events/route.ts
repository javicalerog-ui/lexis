// =====================================================
// POST /api/events
//
// Crea eventos en la tabla `events` desde drafts confirmados por el user.
// Si `create_in_calendar=true`, también crea cada evento en Google Calendar
// (usando el calendario "Lexis · Borradores" por safety net, salvo que
// write_to_primary esté activo en user_settings).
//
// Sprint 15.
//
// GET /api/events
//
// Lista eventos del user (filtros opcionales: ?status=&from=&to=&limit=).
// Usado por /feed (próximos eventos) e /inbox (Sprint 18).
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createEvent as createGCalEvent } from '@/lib/google-calendar/write';
import { loadUserSettings } from '@/lib/time/userTime';

export const runtime = 'nodejs';
export const maxDuration = 60;

const EventDraftSchema = z.object({
  title: z.string().min(1).max(240),
  due_at: z.string().datetime(),
  ends_at: z.string().datetime().nullable().optional(),
  all_day: z.boolean().optional(),
  type: z.enum(['deadline', 'meeting', 'follow_up', 'reminder', 'recurring']).default('reminder'),
  description: z.string().max(2000).nullable().optional(),
  location: z.string().max(240).nullable().optional(),
  attendees: z.array(z.string()).max(50).optional(),
  linked_memory_id: z.string().uuid().nullable().optional(),
  linked_project_id: z.string().uuid().nullable().optional(),
  linked_entity_id: z.string().uuid().nullable().optional(),
});

const CreateSchema = z.object({
  events: z.array(EventDraftSchema).min(1).max(50),
  create_in_calendar: z.boolean().default(false),
  source: z.enum(['voice', 'image', 'text', 'manual']).default('manual'),
});

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof CreateSchema>;
  try {
    body = CreateSchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_body', detail: String(e).slice(0, 240) },
      { status: 400 }
    );
  }

  await loadUserSettings(supabase, user.id, { createIfMissing: true });

  const inserted: any[] = [];
  const errors: any[] = [];

  for (const draft of body.events) {
    let externalEventId: string | null = null;
    let externalCalendarId: string | null = null;

    // 1. Crear en Google Calendar si lo pidió
    if (body.create_in_calendar) {
      try {
        const startISO = draft.due_at;
        const endISO = draft.ends_at ?? (draft.all_day
          ? null
          : new Date(new Date(draft.due_at).getTime() + 3600_000).toISOString());

        const payload: any = {
          summary: draft.title,
          description: draft.description ?? undefined,
          location: draft.location ?? undefined,
        };

        if (draft.all_day) {
          // Calendar API: para all-day, formato YYYY-MM-DD
          const ymd = startISO.slice(0, 10);
          payload.start = { date: ymd };
          payload.end = { date: ymd };
        } else {
          payload.start = { dateTime: startISO };
          payload.end = { dateTime: endISO };
        }

        if (draft.attendees && draft.attendees.length > 0) {
          payload.attendees = draft.attendees
            .filter((a) => /\S+@\S+\.\S+/.test(a))
            .map((email) => ({ email }));
        }

        const gcalEvent = await createGCalEvent(supabase, user.id, payload);
        externalEventId = gcalEvent.id;
        externalCalendarId = (gcalEvent as any).organizer?.email || null;
      } catch (e: any) {
        errors.push({
          title: draft.title,
          error: 'gcal_create_failed',
          detail: String(e?.message || e).slice(0, 200),
        });
        // No abortamos: insertamos en events igualmente para que el user no pierda el draft
      }
    }

    // 2. Insertar en events
    const { data, error } = await supabase
      .from('events')
      .insert({
        user_id: user.id,
        due_at: draft.due_at,
        ends_at: draft.ends_at ?? null,
        all_day: draft.all_day ?? false,
        type: draft.type,
        status: 'pending',
        source: body.source,
        title: draft.title,
        description: draft.description ?? null,
        linked_memory_id: draft.linked_memory_id ?? null,
        linked_project_id: draft.linked_project_id ?? null,
        linked_entity_id: draft.linked_entity_id ?? null,
        external_event_id: externalEventId,
        external_calendar_id: externalCalendarId,
        confidence: 1.0,
        metadata: {
          attendees: draft.attendees ?? [],
          location: draft.location ?? null,
          created_in_calendar: !!externalEventId,
        },
      })
      .select('id, title, due_at, type, status')
      .single();

    if (error) {
      errors.push({ title: draft.title, error: 'db_insert_failed', detail: error.message });
    } else if (data) {
      inserted.push(data);
    }
  }

  return NextResponse.json({
    inserted_count: inserted.length,
    error_count: errors.length,
    inserted,
    errors,
  });
}

// ============ GET ============

export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const status = url.searchParams.get('status') as
    | 'pending' | 'done' | 'snoozed' | 'cancelled' | 'expired' | null;
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 200);

  let q = supabase
    .from('events')
    .select(
      'id, due_at, ends_at, all_day, type, status, source, title, description, linked_memory_id, linked_project_id, linked_entity_id, external_event_id, external_calendar_id, confidence, metadata, responded_at, created_at'
    )
    .eq('user_id', user.id)
    .order('due_at', { ascending: true })
    .limit(limit);

  if (status) q = q.eq('status', status);
  if (from) q = q.gte('due_at', from);
  if (to) q = q.lte('due_at', to);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json(
      { error: 'db_error', detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ events: data ?? [] });
}
