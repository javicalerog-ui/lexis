// =====================================================
// lib/events/imageExtractor.ts
//
// Pipeline especializado "captura de calendario / agenda".
// Cuando subes una foto/screenshot de Outlook, Google Calendar
// o cualquier vista de agenda, este extractor le pide al modelo
// con visión que liste los eventos visibles como JSON estructurado.
//
// El resultado va a la UI de preview (/events/preview/[capture])
// para que el user confirme antes de crear los eventos en Calendar.
//
// Sprint 15.
// =====================================================

import { callOpenRouter, visionModel } from '@/lib/llm/openrouter';

const CALENDAR_VISION_PROMPT = `Estás viendo una captura de pantalla o foto de una vista de calendario o agenda (Outlook, Google Calendar, agenda en papel, planning impreso, lo que sea).

Tu tarea: extraer cada evento/cita/tarea visible como JSON estructurado.

Para cada evento extrae:
- title: título principal (sin emojis ni decoración)
- date_local: fecha en formato YYYY-MM-DD según el contexto visible (semana actual implícita salvo que se vea otra cosa)
- start_time_local: hora de inicio en formato HH:MM (24h) o null si es todo el día
- end_time_local: hora de fin en formato HH:MM o null si no se ve
- attendees: lista de personas o lugares mencionados como participantes (puede estar vacía)
- location: ubicación o sala si se ve, null si no
- description: nota o detalle adicional visible, null si no
- confidence: 0-1 sobre la claridad de la lectura

Reglas:
- Si solo ves día de la semana sin fecha (ej. "Martes"), pon date_local como YYYY-MM-DD asumiendo la semana actual del usuario (el cliente proporcionará el rango cuando convierta).
- Si la imagen no es una vista de calendario, devuelve "events": [] con global_confidence baja.
- Eventos all-day → start_time_local: null, end_time_local: null.
- Si solo se ve hora de inicio, deja end_time_local: null.

Formato JSON estricto:
{
  "is_calendar_view": true,
  "view_type": "weekly|daily|monthly|list|other",
  "reference_week_start": "YYYY-MM-DD or null",
  "events": [
    {
      "title": "...",
      "date_local": "YYYY-MM-DD",
      "start_time_local": "HH:MM",
      "end_time_local": "HH:MM",
      "attendees": ["..."],
      "location": "...",
      "description": "...",
      "confidence": 0.9
    }
  ],
  "global_confidence": 0.85
}

Si la imagen está borrosa, recortada o no es claramente un calendario, marca is_calendar_view: false y events: [].`;

export interface CalendarImageEvent {
  title: string;
  date_local: string;
  start_time_local: string | null;
  end_time_local: string | null;
  attendees: string[];
  location: string | null;
  description: string | null;
  confidence: number;
}

export interface CalendarImageExtraction {
  is_calendar_view: boolean;
  view_type: string;
  reference_week_start: string | null;
  events: CalendarImageEvent[];
  global_confidence: number;
}

export async function extractEventsFromCalendarImage(
  publicUrl: string
): Promise<CalendarImageExtraction> {
  const result = await callOpenRouter({
    model: visionModel(),
    temperature: 0.1,
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: CALENDAR_VISION_PROMPT },
          { type: 'image_url', image_url: { url: publicUrl } },
        ],
      },
    ],
    response_format: { type: 'json_object' },
  });

  const cleaned = result.text.trim().replace(/^```json\s*|\s*```$/g, '');
  try {
    return JSON.parse(cleaned) as CalendarImageExtraction;
  } catch (e) {
    throw new Error(
      `Extractor de imagen calendario: JSON no parseable: ${cleaned.slice(0, 220)}`
    );
  }
}

/**
 * Combina date_local + time_local en un ISO con offset del timezone
 * del usuario. Si time es null, usa 09:00 hora local (default razonable
 * para eventos all-day que requieren un "due_at" interno).
 */
export function combineLocalDateTime(
  date: string,
  time: string | null,
  timezone: string
): string {
  const h = time ? time : '09:00';
  // Construimos un ISO sin offset y lo dejamos que el caller (extractor.ts)
  // resuelva via localToUtc.
  return `${date}T${h}:00`;
}
