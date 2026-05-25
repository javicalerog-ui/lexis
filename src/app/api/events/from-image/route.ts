// =====================================================
// POST /api/events/from-image
//
// Recibe la URL pública de una imagen ya subida a Supabase Storage
// (con el pipeline normal de imagen). Llama al extractor de visión
// especializado para listar eventos visibles. Persiste un "draft"
// en memoria del cliente vía respuesta (no toca DB todavía).
//
// El user revisa los eventos en la UI /events/preview, edita lo que
// haga falta y confirma. Solo entonces se crean filas en `events`
// y opcionalmente eventos reales en Google Calendar.
//
// Sprint 15.
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { extractEventsFromCalendarImage } from '@/lib/events/imageExtractor';
import { loadUserSettings, localToUtc } from '@/lib/time/userTime';

export const runtime = 'nodejs';
export const maxDuration = 60;

const Schema = z.object({
  image_url: z.string().url(),
});

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_body', detail: String(e) },
      { status: 400 }
    );
  }

  const settings = await loadUserSettings(supabase, user.id);
  const tz = settings.timezone;

  let extraction;
  try {
    extraction = await extractEventsFromCalendarImage(body.image_url);
  } catch (e) {
    return NextResponse.json(
      { error: 'extraction_failed', detail: String(e).slice(0, 220) },
      { status: 500 }
    );
  }

  if (!extraction.is_calendar_view) {
    return NextResponse.json({
      is_calendar_view: false,
      message:
        'La imagen no parece una vista de calendario. Sube una captura de tu vista semanal/diaria de Outlook o Google Calendar para que pueda extraer los eventos.',
      events: [],
    });
  }

  // Convierte cada evento a un "draft" con due_at_utc resuelto
  const drafts = extraction.events
    .filter((ev) => ev.confidence >= 0.5)
    .map((ev) => {
      const localStart = `${ev.date_local}T${ev.start_time_local ?? '09:00'}:00`;
      const allDay = !ev.start_time_local;
      let dueAtUtc: Date;
      try {
        dueAtUtc = localToUtc(localStart, tz);
      } catch {
        dueAtUtc = new Date(localStart);
      }

      let endsAtUtc: Date | null = null;
      if (ev.end_time_local) {
        try {
          endsAtUtc = localToUtc(`${ev.date_local}T${ev.end_time_local}:00`, tz);
        } catch {}
      }

      return {
        title: ev.title,
        due_at_utc: dueAtUtc.toISOString(),
        ends_at_utc: endsAtUtc?.toISOString() ?? null,
        all_day: allDay,
        location: ev.location,
        attendees: ev.attendees,
        description: ev.description,
        confidence: ev.confidence,
        source_local_date: ev.date_local,
        source_local_time: ev.start_time_local,
      };
    });

  return NextResponse.json({
    is_calendar_view: true,
    view_type: extraction.view_type,
    timezone: tz,
    global_confidence: extraction.global_confidence,
    events: drafts,
  });
}
