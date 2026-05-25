// =====================================================
// lib/time/userTime.ts
//
// Helpers transversales para todo Sprint 14-18.
// Todos los crons y schedulers consultan estos helpers
// antes de "¿toca disparar X?".
//
// Trabajamos con timezone IANA (Europe/Madrid, America/New_York, ...).
// Postgres + JS Date + Intl.DateTimeFormat saben hacer esto.
// No metemos libs externas tipo luxon/date-fns-tz: con Intl basta.
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js';

// ---------- Tipos ----------

export interface UserSettings {
  user_id: string;
  timezone: string;
  preferred_language: string;
  quiet_hours_start: string;            // HH:MM
  quiet_hours_end: string;              // HH:MM
  quiet_hours_enabled: boolean;
  draft_calendar_id: string | null;
  write_to_primary: boolean;
  push_enabled: boolean;
  push_types_enabled: Record<string, boolean>;
  push_offsets_minutes: number[];
}

// ---------- Carga ----------

const DEFAULTS: Omit<UserSettings, 'user_id'> = {
  timezone: 'Europe/Madrid',
  preferred_language: 'es',
  quiet_hours_start: '22:00',
  quiet_hours_end: '08:00',
  quiet_hours_enabled: true,
  draft_calendar_id: null,
  write_to_primary: false,
  push_enabled: true,
  push_types_enabled: {
    deadlines: true,
    meetings: true,
    follow_ups: true,
    reminders: true,
    reviews: true,
  },
  push_offsets_minutes: [1440, 60, 15],
};

/**
 * Carga settings del usuario. Si no existe la row, devuelve defaults
 * y opcionalmente la crea (lazy init en primer acceso).
 */
export async function loadUserSettings(
  supabase: SupabaseClient,
  userId: string,
  options: { createIfMissing?: boolean } = {}
): Promise<UserSettings> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(`loadUserSettings: ${error.message}`);

  if (data) return data as UserSettings;

  const fresh: UserSettings = { user_id: userId, ...DEFAULTS };

  if (options.createIfMissing) {
    await supabase.from('user_settings').insert(fresh);
  }

  return fresh;
}

// ---------- "Ahora" en zona del usuario ----------

/**
 * Devuelve "ahora" en la zona del usuario como string ISO local
 * (sin offset) + componentes desglosados. Útil para evaluar
 * crons "cada lunes 7:30 en hora local".
 */
export function nowInZone(timezone: string, atUtc: Date = new Date()): {
  iso_local: string;            // "2026-05-23T08:15:00"
  year: number;
  month: number;                // 1-12
  day: number;                  // 1-31
  hour: number;                 // 0-23
  minute: number;
  weekday: number;              // 0=Sun, 1=Mon, ..., 6=Sat
  weekday_iso: number;          // 1=Mon, 7=Sun (formato ISO 8601)
} {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });

  const parts = dtf.formatToParts(atUtc);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';

  const weekdayStr = get('weekday');
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const weekday = weekdayMap[weekdayStr] ?? 0;

  const year = parseInt(get('year'));
  const month = parseInt(get('month'));
  const day = parseInt(get('day'));
  const hour = parseInt(get('hour'));
  const minute = parseInt(get('minute'));

  const iso_local =
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` +
    `T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;

  return {
    iso_local,
    year, month, day, hour, minute, weekday,
    weekday_iso: weekday === 0 ? 7 : weekday,
  };
}

// ---------- Cron parsing (minimal) ----------

/**
 * Evalúa si un cron "M H D Mo W" pasaría AHORA según hora local
 * de la zona dada. Solo soporta valores enteros literales, listas
 * (1,3,5), rangos (1-5) y wildcards (*). Suficiente para reglas
 * tipo "0 17 * * 5" (viernes 17:00) o "30 7 * * 1" (lunes 7:30).
 *
 * NOTA: no soporta "step N" ni nombres (MON, JAN). Si quieres más,
 * añade aquí. Por ahora reglas preset usan solo lo soportado.
 */
export function cronMatchesNow(
  cron: string,
  timezone: string,
  atUtc: Date = new Date()
): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [mP, hP, dP, moP, wP] = parts;
  const now = nowInZone(timezone, atUtc);

  return (
    matchField(mP, now.minute) &&
    matchField(hP, now.hour) &&
    matchField(dP, now.day) &&
    matchField(moP, now.month) &&
    matchField(wP, now.weekday)
  );
}

function matchField(spec: string, value: number): boolean {
  if (spec === '*') return true;
  for (const piece of spec.split(',')) {
    if (piece.includes('-')) {
      const [lo, hi] = piece.split('-').map(Number);
      if (value >= lo && value <= hi) return true;
    } else if (parseInt(piece) === value) {
      return true;
    }
  }
  return false;
}

/**
 * Calcula el siguiente "due_at" en UTC para una expresión cron
 * en zona del usuario. Útil para que el cron de proactivo sepa
 * cuándo volver a evaluar una regla sin tener que iterar minuto
 * a minuto. Estrategia: simula minuto a minuto hasta 7 días.
 */
export function nextCronFireUtc(
  cron: string,
  timezone: string,
  fromUtc: Date = new Date()
): Date | null {
  const start = new Date(fromUtc.getTime() + 60_000);                   // próximo minuto
  const horizonMs = 7 * 24 * 60 * 60 * 1000;
  for (let offset = 0; offset < horizonMs; offset += 60_000) {
    const candidate = new Date(start.getTime() + offset);
    if (cronMatchesNow(cron, timezone, candidate)) return candidate;
  }
  return null;
}

// ---------- Quiet hours ----------

/**
 * ¿Está la hora actual del usuario dentro de su ventana
 * de silencio (no enviar push)?
 */
export function isQuietHourNow(
  settings: UserSettings,
  atUtc: Date = new Date()
): boolean {
  if (!settings.quiet_hours_enabled) return false;
  const now = nowInZone(settings.timezone, atUtc);
  const cur = now.hour * 60 + now.minute;
  const start = parseHM(settings.quiet_hours_start);
  const end = parseHM(settings.quiet_hours_end);
  // Ventana puede cruzar medianoche (22:00 → 08:00)
  if (start <= end) {
    return cur >= start && cur < end;
  }
  return cur >= start || cur < end;
}

function parseHM(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// ---------- Conversión local → UTC ----------

/**
 * Convierte una fecha-hora local (ISO sin offset, ej "2026-05-23T08:15:00")
 * en una zona IANA a una Date UTC. Algorítmicamente:
 * 1. Interpreta el string como si fuera UTC (parsea naive).
 * 2. Calcula qué hora local devolvería ese UTC en la zona del usuario.
 * 3. La diferencia es el offset de la zona en ese momento.
 * 4. Aplica el offset al naive UTC para obtener el UTC real.
 */
export function localToUtc(isoLocal: string, timezone: string): Date {
  const naive = new Date(isoLocal + 'Z');                               // pretendamos que es UTC
  const back = nowInZone(timezone, naive);
  const recomposed = new Date(
    Date.UTC(back.year, back.month - 1, back.day, back.hour, back.minute)
  );
  const diff = naive.getTime() - recomposed.getTime();                  // offset en ms
  return new Date(naive.getTime() + diff);
}

// ---------- Pretty format ----------

/**
 * Formatea una Date UTC para mostrar en zona del usuario.
 * Devuelve cosas como "vie 30 may · 17:00".
 */
export function formatInZone(
  date: Date,
  timezone: string,
  locale: string = 'es-ES'
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}
