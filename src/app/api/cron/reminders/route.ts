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
import { isCronRequestAuthorized } from '@/lib/security/cron-auth.mjs';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Solo avisamos de eventos cuya hora llegó dentro de esta ventana hacia
// atrás. Evita vomitar recordatorios rancios (de días atrás, aún pending)
// si el latido estuvo caído un rato; a la vez tolera retrasos del cron.
const GRACE_MS = 2 * 60 * 60_000; // 2 h

// Tipos que se notifican "a su hora". `reminder` = "recuérdame X"; `deadline`
// = "antes del viernes". Meetings y follow_ups tienen su propia lógica de
// pre-aviso en /api/cron/proactive, así que no se tocan aquí.
const REMINDER_TYPES = ['reminder', 'deadline'];

export async function GET(req: Request) {
  if (!isCronRequestAuthorized(req.headers)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();
  const windowStart = new Date(now.getTime() - GRACE_MS);

  const { data: due, error } = await supabase
    .from('events')
    .select('id, user_id, title, type, due_at, linked_memory_id')
    .eq('status', 'pending')
    .is('notified_at', null)
    .in('type', REMINDER_TYPES)
    .lte('due_at', now.toISOString())
    .gte('due_at', windowStart.toISOString())
    .order('due_at', { ascending: true })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: 'db_error', detail: error.message }, { status: 500 });
  }

  const results: Array<Record<string, unknown>> = [];

  for (const ev of due ?? []) {
    try {
      const res = await sendPush(
        supabase,
        ev.user_id,
        {
          title: ev.type === 'deadline' ? '⏰ Vence hoy' : '🔔 Recordatorio',
          body: ev.title,
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
          type_key: ev.type === 'deadline' ? 'deadlines' : 'reminders',
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
