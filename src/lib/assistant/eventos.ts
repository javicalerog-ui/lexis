// =====================================================
// Observabilidad del asistente: una fila en assistant_events por pregunta
// (sin el texto) y aviso push al admin si un usuario encadena 2 errores.
//
// Todo es best-effort: si la tabla aún no existe (migración sin aplicar) o el
// push falla, se ignora. Nunca debe romper ni retrasar la respuesta: el route
// lo llama dentro de waitUntil.
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendPush } from '@/lib/push/send';

export type CodigoAsistente = 'ok' | 'busy' | 'timeout' | 'internal';

export async function registrarEvento(
  svc: SupabaseClient,
  ev: { userId: string; kind: string; code: CodigoAsistente; ms: number; detail?: string }
): Promise<void> {
  try {
    const { error } = await svc.from('assistant_events').insert({
      user_id: ev.userId,
      kind: ev.kind,
      code: ev.code,
      ms: Math.round(ev.ms),
      detail: ev.detail ? ev.detail.slice(0, 300) : null,
    });
    if (error || ev.code === 'ok') return;

    // ¿Segundo error seguido de este usuario? → aviso al admin.
    const { data } = await svc
      .from('assistant_events')
      .select('code')
      .eq('user_id', ev.userId)
      .order('created_at', { ascending: false })
      .limit(2);
    if (!data || data.length < 2 || data.some((r) => r.code === 'ok')) return;

    const { data: lista } = await svc.auth.admin.listUsers({ perPage: 50 });
    const admins = (lista?.users ?? []).filter((u) => u.app_metadata?.role === 'admin');
    const afectado = (lista?.users ?? []).find((u) => u.id === ev.userId);
    const quien = afectado?.email?.split('@')[0] ?? 'un usuario';
    for (const a of admins) {
      await sendPush(
        svc,
        a.id,
        {
          title: 'Lexis: el asistente está fallando',
          body: `2 errores seguidos a ${quien} (último: ${ev.code}).`,
          url: '/',
          tag: 'lexis-asistente-errores',
        },
        { ignore_quiet_hours: false }
      ).catch(() => undefined);
    }
  } catch {
    // best-effort
  }
}
