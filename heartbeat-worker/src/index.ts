// =====================================================
// Lexis heartbeat · Cloudflare Worker (Cron Trigger)
//
// Late fiable que dispara los crons de Lexis cada 5 minutos. Sustituye al
// workflow de GitHub Actions, que GitHub estrangula a "cada varias horas" en
// repos de poca actividad (2026-09-23: recordatorios llegaban tarde o se
// perdian). Cloudflare SI respeta el cron al minuto.
//
// Pinga los dos endpoints que entregan notificaciones:
//   - /api/cron/reminders  (reminder/deadline + follow_up con hora)
//   - /api/cron/proactive  (reglas: follow-ups del dia, revisiones, reuniones)
//
// El secreto NO va en el codigo: se guarda como secret del Worker
//   wrangler secret put LEXIS_CRON_SECRET
// y debe ser IGUAL al CRON_SECRET de Vercel.
// =====================================================

export interface Env {
  LEXIS_CRON_SECRET: string;
  LEXIS_URL?: string; // opcional; por defecto produccion
}

const ENDPOINTS = ['/api/cron/reminders', '/api/cron/proactive'];

async function pingAll(env: Env): Promise<Array<{ path: string; status: number | string }>> {
  const base = (env.LEXIS_URL || 'https://lexis-jade.vercel.app').replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${env.LEXIS_CRON_SECRET}` };
  return Promise.all(
    ENDPOINTS.map(async (path) => {
      try {
        const r = await fetch(base + path, { headers });
        return { path, status: r.status };
      } catch (e) {
        return { path, status: `error: ${(e as Error).message}` };
      }
    })
  );
}

export default {
  // Disparo programado (cron trigger).
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(pingAll(env).then((r) => console.log('[heartbeat]', JSON.stringify(r))));
  },

  // Disparo manual por HTTP, util para probar sin esperar al cron:
  //   curl https://lexis-heartbeat.<subdominio>.workers.dev/
  async fetch(_req: Request, env: Env): Promise<Response> {
    const results = await pingAll(env);
    return new Response(JSON.stringify({ ok: true, results }, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
