// =====================================================
// GET /api/cron/reminders
//
// Dispara un push por cada evento "recordatorio" o "deadline" cuya hora
// (due_at) ya llegó y que aún no se ha avisado (notified_at IS NULL).
//
// Es la pieza que faltaba para que "recuérdame el lunes a las 7" acabe en
// un aviso real. Complementa a /api/cron/proactive (que cubre reuniones,
// follow-ups y resúmenes vía proactive_rules); este endpoint es directo
// sobre `events`, sin depender de que existan reglas preconfiguradas.
//
// Lo invoca el "latido" del Worker de Cloudflare cada ~15 min (el plan
// gratuito de Vercel no permite crons frecuentes). Protegido con
// Authorization: Bearer ${CRON_SECRET}.
// =====================================================

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { sendPush } from '@/lib/push/send';
import { loadUserSettings } from '@/lib/time/userTime';
import { isCronRequestAuthorized } from '@/lib/security/cron-auth.mjs';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Solo avisamos de eventos cuya hora llegó dentro de esta ventana hacia
// atrás. Evita vomitar recordatorios rancios (de días atrás, aún pending)
// si el latido estuvo caído un rato; a la vez tolera retrasos del cron.
const GRACE_MS = 2 * 60 * 60_000; // 2 h

// Cuánto hacia ADELANTE miramos para poder disparar el "aviso previo" de
// reuniones/citas (metadata.remind_before_minutes). Un evento a las 15:30 con
// 10 min de aviso hay que cogerlo ya a las 15:20, cuando due_at aún es futuro.
const MAX_LEAD_MS = 60 * 60_000; // 60 min (tope de aviso previo)
const MAX_LEAD_MIN = 60;

// Tipos que se notifican "a su hora". `reminder` = "recuérdame X"; `deadline`
// = "antes del viernes". Los `follow_up` CON hora concreta (all_day=false)
// también se avisan aquí, a su hora exacta; los follow_up SIN hora (all_day=true)
// los lleva la regla proactiva commitment_followup y se filtran más abajo.
// `meeting` = reunión/cita: se avisa con antelación si trae remind_before_minutes.
const REMINDER_TYPES = ['reminder', 'deadline', 'follow_up', 'meeting'];

export async function GET(req: Request) {
  if (!isCronRequestAuthorized(req.headers)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();
  const windowStart = new Date(now.getTime() - GRACE_MS);
  const windowEnd = new Date(now.getTime() + MAX_LEAD_MS);

  // Traemos también algo de futuro (hasta MAX_LEAD) para poder lanzar el aviso
  // previo de reuniones ANTES de su hora. El disparo real por evento se decide
  // abajo con remind_before_minutes.
  const { data: due, error } = await supabase
    .from('events')
    .select('id, user_id, title, type, all_day, due_at, metadata, linked_memory_id')
    .eq('status', 'pending')
    .is('notified_at', null)
    .in('type', REMINDER_TYPES)
    .lte('due_at', windowEnd.toISOString())
    .gte('due_at', windowStart.toISOString())
    .order('due_at', { ascending: true })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: 'db_error', detail: error.message }, { status: 500 });
  }

  const results: Array<Record<string, unknown>> = [];

  for (const ev of due ?? []) {
    // follow_up SIN hora concreta (all_day): no lo disparamos aquí para no
    // avisar a la hora por defecto (09:00). Lo gestiona la regla proactiva
    // commitment_followup como "¿lo has hecho?" del día.
    if (ev.type === 'follow_up' && ev.all_day) continue;

    // Aviso previo (reuniones/citas): metadata.remind_before_minutes. 0 = a su
    // hora. El disparo efectivo es due_at - lead; si aún no toca, saltamos y
    // lo cogerá un tick posterior (el evento sigue pending, notified_at null).
    const leadMin = Math.max(
      0,
      Math.min(MAX_LEAD_MIN, Number((ev.metadata as any)?.remind_before_minutes) || 0)
    );
    const dueMs = new Date(ev.due_at).getTime();
    if (now.getTime() < dueMs - leadMin * 60_000) continue;

    try {
      // Con aviso previo, el mensaje dice la HORA del evento ("A las 15:30 ·
      // Reunión"). Sin aviso previo, formato clásico.
      let pushTitle = ev.type === 'deadline' ? '⏰ Vence hoy' : '🔔 Recordatorio';
      let pushBody = ev.title;
      if (leadMin > 0) {
        const tz = (await loadUserSettings(supabase, ev.user_id)).timezone;
        const hhmm = new Intl.DateTimeFormat('es-ES', {
          timeZone: tz,
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(ev.due_at));
        pushTitle = '📅 Pronto';
        pushBody = `A las ${hhmm} · ${ev.title}`;
      }

      const res = await sendPush(
        supabase,
        ev.user_id,
        {
          title: pushTitle,
          body: pushBody,
          // La UI de detalle de evento aún no existe; abrimos el timeline.
          url: '/timeline',
          tag: `event-${ev.id}`,
          data: { event_id: ev.id, kind: 'reminder' },
          require_interaction: true,
        },
        {
          // Un recordatorio a una hora que el usuario pidió EXPRESAMENTE debe
          // sonar aunque caiga en horas de silencio (p. ej. las 7:00).
          ignore_quiet_hours: true,
          type_key:
            ev.type === 'deadline'
              ? 'deadlines'
              : ev.type === 'follow_up'
                ? 'follow_ups'
                : ev.type === 'meeting'
                  ? 'meetings'
                  : 'reminders',
        }
      );

      // Marcar avisado tras un envío SIN excepción (aunque sent=0 por no haber
      // suscripciones: el recordatorio "ocurrió", no re-spamear cada tick).
      await supabase.from('events').update({ notified_at: now.toISOString() }).eq('id', ev.id);

      results.push({ id: ev.id, title: ev.title, type: ev.type, sent: res.sent, failed: res.failed });
    } catch (e) {
      // No marcamos notified_at: reintentará en el próximo tick, dentro de la
      // ventana de 2 h (típico: VAPID mal configurado en el entorno).
      results.push({ id: ev.id, error: String((e as Error)?.message || e).slice(0, 160) });
    }
  }

  return NextResponse.json({
    timestamp: now.toISOString(),
    due_found: due?.length ?? 0,
    notified: results.filter((r) => 'sent' in r).length,
    results,
  });
}
