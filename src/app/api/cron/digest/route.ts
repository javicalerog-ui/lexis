// =====================================================
// POST /api/cron/digest
// Cron protegido por Authorization: Bearer <CRON_SECRET>. Selecciona usuarios
// cuya cadencia + hora coincide con "ahora" y genera+envía.
//
// Estrategia simple:
//   - weekly: enviar si hoy es day_of_week y la hora actual
//     UTC >= send_hour_utc, y last_sent_at fue hace >= 6 días.
//   - biweekly: idem pero >= 13 días.
//   - monthly: enviar si hoy es day_of_month y last_sent_at >= 28 días.
// =====================================================

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { generateDigest } from '@/lib/digest/generate';
import { renderDigestEmail } from '@/lib/digest/render-email';
import { sendEmail } from '@/lib/digest/email';
import { isCronRequestAuthorized } from '@/lib/security/cron-auth.mjs';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MIN_DAYS_BETWEEN: Record<string, number> = {
  weekly: 6,
  biweekly: 13,
  monthly: 28,
};

function shouldSend(
  pref: any,
  now: Date
): { eligible: boolean; reason: string } {
  if (!pref.enabled) return { eligible: false, reason: 'disabled' };

  const cadence = pref.cadence as 'weekly' | 'biweekly' | 'monthly';
  const hourUtc = now.getUTCHours();
  if (hourUtc < (pref.send_hour_utc ?? 7)) {
    return { eligible: false, reason: 'hour_not_yet' };
  }

  // Check anti-doble-envío
  if (pref.last_sent_at) {
    const days = Math.floor(
      (now.getTime() - new Date(pref.last_sent_at).getTime()) / 86_400_000
    );
    if (days < (MIN_DAYS_BETWEEN[cadence] ?? 6)) {
      return { eligible: false, reason: `recent_send_${days}d` };
    }
  }

  // Match del día
  if (cadence === 'weekly' || cadence === 'biweekly') {
    const dow = now.getUTCDay(); // 0=sun
    if (dow !== (pref.day_of_week ?? 1)) {
      return { eligible: false, reason: `wrong_dow_${dow}` };
    }
  } else if (cadence === 'monthly') {
    const dom = now.getUTCDate();
    if (dom !== (pref.day_of_month ?? 1)) {
      return { eligible: false, reason: `wrong_dom_${dom}` };
    }
  }

  return { eligible: true, reason: 'ok' };
}

export async function POST(req: Request) {
  if (!isCronRequestAuthorized(req.headers)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();

  // Candidatos: todos los enabled
  const { data: prefs } = await supabase
    .from('digest_preferences')
    .select('user_id, enabled, cadence, send_hour_utc, day_of_week, day_of_month, email, last_sent_at');

  const results: Array<{
    user_id: string;
    status: 'sent' | 'failed' | 'skipped';
    reason?: string;
    digest_id?: string;
    error?: string;
  }> = [];

  for (const pref of prefs ?? []) {
    const eligibility = shouldSend(pref, now);
    if (!eligibility.eligible) {
      results.push({
        user_id: pref.user_id,
        status: 'skipped',
        reason: eligibility.reason,
      });
      continue;
    }

    try {
      // Resolver email
      const { data: authUser } = await supabase.auth.admin.getUserById(pref.user_id);
      const destination = pref.email || authUser?.user?.email;
      if (!destination) {
        results.push({
          user_id: pref.user_id,
          status: 'failed',
          error: 'no_destination',
        });
        continue;
      }

      // Generar + persistir + enviar
      const digest = await generateDigest(supabase, pref.user_id, pref.cadence);

      const { data: inserted, error: insErr } = await supabase
        .from('digests')
        .insert({
          user_id: pref.user_id,
          period_start: digest.period_start,
          period_end: digest.period_end,
          cadence: pref.cadence,
          payload: digest.payload,
          metrics: digest.metrics,
          model_used: digest.model_used,
          status: 'draft',
        })
        .select('id')
        .single();

      if (insErr || !inserted) {
        results.push({
          user_id: pref.user_id,
          status: 'failed',
          error: `persist:${insErr?.message}`,
        });
        continue;
      }

      const rendered = renderDigestEmail(digest, { digestId: inserted.id });
      await supabase
        .from('digests')
        .update({ html_email: rendered.html })
        .eq('id', inserted.id);

      try {
        const sent = await sendEmail({
          to: destination,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          tags: [
            { name: 'kind', value: 'digest' },
            { name: 'cadence', value: pref.cadence },
            { name: 'origin', value: 'cron' },
          ],
        });

        await supabase
          .from('digests')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            sent_to: destination,
            resend_message_id: sent.id,
          })
          .eq('id', inserted.id);

        await supabase
          .from('digest_preferences')
          .update({ last_sent_at: new Date().toISOString() })
          .eq('user_id', pref.user_id);

        results.push({
          user_id: pref.user_id,
          status: 'sent',
          digest_id: inserted.id,
        });
      } catch (sendErr) {
        await supabase
          .from('digests')
          .update({
            status: 'failed',
            send_error: String(sendErr).slice(0, 500),
          })
          .eq('id', inserted.id);

        results.push({
          user_id: pref.user_id,
          status: 'failed',
          digest_id: inserted.id,
          error: String(sendErr).slice(0, 300),
        });
      }
    } catch (e) {
      results.push({
        user_id: pref.user_id,
        status: 'failed',
        error: String(e).slice(0, 300),
      });
    }
  }

  return NextResponse.json({
    ran_at: now.toISOString(),
    candidates: prefs?.length ?? 0,
    sent: results.filter((r) => r.status === 'sent').length,
    failed: results.filter((r) => r.status === 'failed').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    results,
  });
}
