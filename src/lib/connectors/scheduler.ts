// =====================================================
// Scheduler simple para connectors.
//
// Sintaxis:
//   - null o ""        → nunca (solo webhook/manual)
//   - "every:15m"      → cada 15 minutos
//   - "every:1h"       → cada hora
//   - "every:6h"       → cada 6 horas
//   - "every:1d"       → cada día
//   - "daily:7"        → todos los días a las 7 UTC
//   - "daily:7:30"     → todos los días a las 7:30 UTC
//
// No es cron completo. Si en el futuro hace falta, se puede
// añadir un parser cron real sin romper estos.
// =====================================================

export interface ShouldRunResult {
  should_run: boolean;
  reason: string;
  next_run_estimate?: string;
}

const EVERY_REGEX = /^every:(\d+)([mhd])$/;
const DAILY_REGEX = /^daily:(\d{1,2})(?::(\d{1,2}))?$/;

function everyToMs(value: string): number | null {
  const m = value.match(EVERY_REGEX);
  if (!m) return null;
  const n = parseInt(m[1]);
  const unit = m[2];
  if (unit === 'm') return n * 60_000;
  if (unit === 'h') return n * 3_600_000;
  if (unit === 'd') return n * 86_400_000;
  return null;
}

export function shouldRunNow(
  schedule: string | null | undefined,
  lastRunAt: string | null | undefined,
  now: Date = new Date()
): ShouldRunResult {
  if (!schedule || !schedule.trim()) {
    return { should_run: false, reason: 'no_schedule' };
  }

  // every:Nu
  const everyMs = everyToMs(schedule);
  if (everyMs !== null) {
    if (!lastRunAt) {
      return { should_run: true, reason: 'never_run' };
    }
    const elapsed = now.getTime() - new Date(lastRunAt).getTime();
    if (elapsed >= everyMs) {
      return { should_run: true, reason: `elapsed_${Math.floor(elapsed / 60000)}m` };
    }
    return {
      should_run: false,
      reason: `wait_${Math.floor((everyMs - elapsed) / 60000)}m`,
    };
  }

  // daily:H[:M]
  const dailyMatch = schedule.match(DAILY_REGEX);
  if (dailyMatch) {
    const targetHour = parseInt(dailyMatch[1]);
    const targetMinute = dailyMatch[2] ? parseInt(dailyMatch[2]) : 0;

    const nowH = now.getUTCHours();
    const nowM = now.getUTCMinutes();

    // ¿Ya hemos pasado de la hora target hoy?
    const passedToday =
      nowH > targetHour || (nowH === targetHour && nowM >= targetMinute);
    if (!passedToday) {
      return { should_run: false, reason: 'before_daily_hour' };
    }

    // ¿Ya se corrió hoy?
    if (lastRunAt) {
      const last = new Date(lastRunAt);
      const sameUtcDay =
        last.getUTCFullYear() === now.getUTCFullYear() &&
        last.getUTCMonth() === now.getUTCMonth() &&
        last.getUTCDate() === now.getUTCDate();
      if (sameUtcDay) {
        return { should_run: false, reason: 'already_ran_today' };
      }
    }
    return { should_run: true, reason: 'daily_window' };
  }

  return { should_run: false, reason: `invalid_schedule:${schedule}` };
}

/**
 * Validador para usar al crear/actualizar un connector.
 */
export function isValidSchedule(s: string | null | undefined): boolean {
  if (!s || !s.trim()) return true;          // null = válido (sin schedule)
  return EVERY_REGEX.test(s) || DAILY_REGEX.test(s);
}
