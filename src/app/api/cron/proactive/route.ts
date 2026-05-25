// =====================================================
// GET /api/cron/proactive
//
// Cron scheduler que evalúa todas las reglas proactivas habilitadas
// y dispara las que están "due". Se ejecuta cada 5 minutos.
//
// Para reglas cron: comprueba cronMatchesNow en la zona de la regla.
// Para reglas event: deja que cada executor evalúe su condición y
// decida si dispara (return fired:false si no toca).
//
// Protegido con Bearer ${CRON_SECRET}.
//
// Sprint 17.
// =====================================================

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { cronMatchesNow, nextCronFireUtc } from '@/lib/time/userTime';
import { executeAction } from '@/lib/proactive/executors';

export const runtime = 'nodejs';
export const maxDuration = 60;

const TICK_TOLERANCE_MS = 5 * 60_000;     // si fire estaba en últimos 5min, considéralo "ahora"

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();

  // Cargar reglas habilitadas. Para optimizar, podríamos filtrar por
  // next_due_at <= now+5min para reglas cron, pero los event-based
  // tienen next_due_at=null y siempre hay que evaluarlos. Cargamos todo.
  const { data: rules, error } = await supabase
    .from('proactive_rules')
    .select('*')
    .eq('enabled', true);

  if (error) {
    return NextResponse.json(
      { error: 'db_error', detail: error.message },
      { status: 500 }
    );
  }

  const results: any[] = [];

  for (const rule of rules ?? []) {
    try {
      let shouldEvaluate = false;

      if (rule.trigger_type === 'cron') {
        const cron = (rule.trigger_config as any).cron as string;
        // Match si cron coincide AHORA o en los últimos 5 min (cubre desfase
        // de ejecución del scheduler de Cloudflare).
        if (cronMatchesNow(cron, rule.timezone, now)) {
          shouldEvaluate = true;
        } else {
          // Backcheck por si el cron pasó hace minutos y aún no se ha disparado
          for (let i = 1; i <= 5; i++) {
            const past = new Date(now.getTime() - i * 60_000);
            if (cronMatchesNow(cron, rule.timezone, past)) {
              // Confirma que no se haya disparado ya en esta ventana
              if (
                !rule.last_fired_at ||
                new Date(rule.last_fired_at).getTime() < past.getTime() - 60_000
              ) {
                shouldEvaluate = true;
              }
              break;
            }
          }
        }
      } else if (rule.trigger_type === 'event') {
        // Eval continua: dejamos que el executor decida.
        shouldEvaluate = true;

        // Anti-spam para event-based: si se disparó hace menos de 5 min, skip.
        if (rule.last_fired_at) {
          const sinceLast = now.getTime() - new Date(rule.last_fired_at).getTime();
          if (sinceLast < TICK_TOLERANCE_MS) {
            shouldEvaluate = false;
          }
        }
      }

      if (!shouldEvaluate) {
        results.push({ rule_id: rule.id, name: rule.name, skipped: 'not_due' });
        continue;
      }

      const exec = await executeAction({
        supabase,
        userId: rule.user_id,
        rule,
        timezone: rule.timezone,
      });

      if (exec.fired) {
        const update: Record<string, unknown> = { last_fired_at: now.toISOString() };
        if (rule.trigger_type === 'cron') {
          const nxt = nextCronFireUtc(
            (rule.trigger_config as any).cron,
            rule.timezone,
            new Date(now.getTime() + 60_000)
          );
          update.next_due_at = nxt ? nxt.toISOString() : null;
        }
        await supabase
          .from('proactive_rules')
          .update(update)
          .eq('id', rule.id);
      }

      results.push({
        rule_id: rule.id,
        name: rule.name,
        fired: exec.fired,
        reason: exec.reason,
        agent_action_id: exec.agent_action_id,
      });
    } catch (e: any) {
      results.push({
        rule_id: rule.id,
        name: rule.name,
        error: String(e?.message || e).slice(0, 200),
      });
    }
  }

  return NextResponse.json({
    timestamp: now.toISOString(),
    rules_evaluated: rules?.length ?? 0,
    rules_fired: results.filter((r) => r.fired).length,
    results,
  });
}
