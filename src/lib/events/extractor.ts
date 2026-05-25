// =====================================================
// lib/events/extractor.ts
//
// Detecta menciones temporales en el contenido de una memoria
// y crea filas en la tabla `events`.
//
// Política de ventana (Sprint 15 opción C):
//   - futuras: sin límite
//   - pasadas: solo si due_at está a <= 7 días en el pasado
//                (típico para follow-ups y context)
//
// Anclado al timezone del usuario y a `captured_at` de la memoria.
// Cuando dictas "el viernes" un miércoles, el viernes es el inmediato
// posterior en zona del usuario, no UTC ciego.
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { chatWithEscalation } from '@/lib/llm/escalation';
import { loadUserSettings, formatInZone } from '@/lib/time/userTime';

// ---------- Tipos ----------

type ExtractorType = 'deadline' | 'meeting' | 'follow_up' | 'reminder' | 'recurring';

interface ExtractedEvent {
  title: string;
  due_at: string;                    // ISO 8601 con zona inferida
  ends_at?: string | null;
  all_day?: boolean;
  type: ExtractorType;
  description?: string;
  confidence: number;                // 0-1
}

interface ExtractorOutput {
  events: ExtractedEvent[];
  confidence: number;                // confianza global del extractor
}

interface ExtractorContext {
  userId: string;
  memoryId: string;
  capturedAtUtc: Date;
  rawText: string;
  summary: string;
  linkedProjectId?: string | null;
  linkedEntityId?: string | null;
  source: 'voice' | 'image' | 'text' | 'calendar' | 'manual';
}

// ---------- Prompt ----------

const SYSTEM_PROMPT = `Eres un extractor especializado en detectar fechas, compromisos y eventos dentro de textos en español o inglés.

Tu tarea: encontrar TODAS las menciones temporales accionables en el texto y devolverlas como JSON estructurado.

Tipos de evento:
- "deadline": fecha límite ("antes del viernes", "para finales de mes", "tope día 30")
- "meeting": reunión/cita con persona/lugar específico ("comida con Alfonso el martes 14h")
- "follow_up": compromiso del usuario hacia otra parte ("envío X a Y antes del Z", "llamo a M mañana")
- "reminder": recordatorio neutro sin compromiso ("acuérdate de comprar X")
- "recurring": evento que se repite ("cada lunes", "todos los viernes")

Reglas de resolución de fechas relativas:
- "Hoy" = la fecha del campo captured_at proporcionado.
- "Mañana" = captured_at + 1 día.
- "El viernes" (sin más contexto) = el viernes más próximo en el futuro (inclusive si es hoy y aún no son las 23:59).
- "La semana que viene" = lunes de la semana siguiente.
- "Este mes" = último día del mes actual a las 23:59.
- "En 2 semanas" = captured_at + 14 días.
- Si NO hay hora específica y el evento es un día → all_day: true, due_at = ese día a las 09:00 hora local.
- Si HAY hora → all_day: false, due_at con esa hora.

Política de ventana:
- Incluye eventos en el futuro (sin límite).
- Incluye eventos pasados solo si fueron en los últimos 7 días desde captured_at (útiles para follow-ups: "envié el lunes" → checkpoint).
- Descarta menciones puramente históricas más antiguas.

Formato JSON requerido:
{
  "events": [
    {
      "title": "Reunión con Alfonso sobre Polonia",
      "due_at": "2026-05-26T14:00:00+02:00",
      "ends_at": null,
      "all_day": false,
      "type": "meeting",
      "description": "Hablar de avance de propuesta y siguientes pasos",
      "confidence": 0.9
    }
  ],
  "confidence": 0.85
}

Si no hay ningún evento accionable, devuelve { "events": [], "confidence": 1.0 }.

Nunca inventes detalles que no estén en el texto. Si el evento es ambiguo, asígnale confidence baja (< 0.7) en lugar de saltártelo.`;

// ---------- Helpers de fechas ----------

function isWithinWindow(dueAtUtc: Date, capturedAtUtc: Date): boolean {
  const diffMs = dueAtUtc.getTime() - capturedAtUtc.getTime();
  const sevenDaysMs = 7 * 86400_000;
  // Aceptamos cualquier futuro y hasta 7 días pasados
  return diffMs >= -sevenDaysMs;
}

// ---------- Extractor principal ----------

/**
 * Extrae y persiste eventos de una memoria. Llamado desde el
 * pipeline de ingestión después del attach.
 *
 * Es side-effect: inserta filas en `events`. No bloquea el pipeline
 * si falla: lo logueamos y seguimos.
 */
export async function extractAndPersistEvents(
  supabase: SupabaseClient,
  ctx: ExtractorContext
): Promise<{ inserted: number; skipped: number; reason?: string }> {
  // Skip si el texto es muy corto (probablemente no tiene fecha)
  const usefulText = ctx.summary + '\n' + ctx.rawText;
  if (usefulText.trim().length < 40) {
    return { inserted: 0, skipped: 0, reason: 'text_too_short' };
  }

  // Carga timezone del user
  const settings = await loadUserSettings(supabase, ctx.userId);
  const tz = settings.timezone;
  const capturedAtLocal = formatInZone(ctx.capturedAtUtc, tz, 'sv-SE');     // ISO-ish

  const prompt = `Texto a analizar:
"""
${usefulText.slice(0, 6_000)}
"""

Contexto:
- captured_at (UTC): ${ctx.capturedAtUtc.toISOString()}
- captured_at (zona ${tz}): ${capturedAtLocal}
- timezone del usuario: ${tz}
- source: ${ctx.source}

Devuelve JSON estricto.`;

  let parsed: ExtractorOutput;
  try {
    const result = await chatWithEscalation<ExtractorOutput>(prompt, {
      system: SYSTEM_PROMPT,
      temperature: 0.1,
      max_tokens: 1200,
      confidence_field: 'confidence' as keyof ExtractorOutput,
    });
    parsed = result.parsed;
  } catch (e) {
    console.error('[event_extractor] LLM falló', e);
    return { inserted: 0, skipped: 0, reason: 'llm_failed' };
  }

  if (!parsed.events || parsed.events.length === 0) {
    return { inserted: 0, skipped: 0, reason: 'no_events_found' };
  }

  let inserted = 0;
  let skipped = 0;

  for (const ev of parsed.events) {
    if (ev.confidence < 0.6) {
      skipped++;
      continue;
    }

    let dueAt: Date;
    try {
      dueAt = new Date(ev.due_at);
      if (isNaN(dueAt.getTime())) throw new Error('invalid');
    } catch {
      skipped++;
      continue;
    }

    if (!isWithinWindow(dueAt, ctx.capturedAtUtc)) {
      skipped++;
      continue;
    }

    let endsAt: Date | null = null;
    if (ev.ends_at) {
      try {
        endsAt = new Date(ev.ends_at);
        if (isNaN(endsAt.getTime())) endsAt = null;
      } catch {
        endsAt = null;
      }
    }

    const { error } = await supabase.from('events').insert({
      user_id: ctx.userId,
      due_at: dueAt.toISOString(),
      ends_at: endsAt?.toISOString() ?? null,
      all_day: ev.all_day ?? false,
      type: ev.type,
      status: 'pending',
      source: ctx.source,
      title: ev.title.slice(0, 240),
      description: ev.description?.slice(0, 2000) ?? null,
      linked_memory_id: ctx.memoryId,
      linked_project_id: ctx.linkedProjectId ?? null,
      linked_entity_id: ctx.linkedEntityId ?? null,
      confidence: ev.confidence,
      metadata: {
        extracted_from: 'memory',
        extractor_version: 'v1',
      },
    });

    if (error) {
      console.error('[event_extractor] insert error', error);
      skipped++;
    } else {
      inserted++;
    }
  }

  return { inserted, skipped };
}
