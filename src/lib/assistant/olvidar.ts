// =====================================================
// «Olvida lo último» / «borra lo que te acabo de decir» (propuesta 1.8)
//
// Retira la ÚLTIMA memoria guardada desde el chat (texto o foto) en las
// últimas 2 horas: borrado recuperable (status='deleted', como el resto de
// la app), borra el fichero si era una foto y cancela los avisos que se crearon
// a partir de ella. El propio «olvida…» no se guarda.
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { enSegundaPersona } from './registro';

const RX_OLVIDAR =
  /^\s*(?:por favor,?\s*)?(?:olv[ií]da(?:te)?(?:\s+de)?|borra|elimina|quita)\s+(?:lo\s+[uú]ltimo|eso|esto|lo\s+anterior|lo\s+que\s+te\s+(?:acabo\s+de|he)\s+(?:decir|dicho|contar|contado|mandar|mandado|enviar|enviado))\b[\s.!¡?¿]*(?:por favor)?[\s.!]*$/i;

export function esPeticionOlvidar(texto: string): boolean {
  return RX_OLVIDAR.test(texto);
}

const VENTANA_MS = 2 * 3_600_000;

export async function olvidarUltimo(svc: SupabaseClient, userId: string): Promise<string> {
  const desde = new Date(Date.now() - VENTANA_MS).toISOString();
  const { data, error } = await svc
    .from('memories')
    .select('id, summary, source_metadata, captured_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .in('source_metadata->>via', ['asistente', 'asistente-foto'])
    .gte('captured_at', desde)
    .order('captured_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`olvidar: ${error.message}`);
  const m = data?.[0];
  if (!m) {
    return 'No encuentro nada que me hayas contado en las últimas dos horas para olvidar.';
  }

  const { error: e2 } = await svc
    .from('memories')
    .update({ status: 'deleted' })
    .eq('id', m.id)
    .eq('user_id', userId);
  if (e2) throw new Error(`olvidar: ${e2.message}`);

  // Si era una foto, el fichero se va ya. Si esto falla, la limpieza diaria
  // lo recoge porque su memoria queda en 'deleted'.
  const ruta = (m.source_metadata as { storage_path?: string } | null)?.storage_path;
  if (ruta) await svc.storage.from('lexis-raw').remove([ruta]);

  // Si había sustituido a otra memoria (una corrección), la antigua vuelve:
  // olvidar lo último no puede dejarle sin ninguno de los dos datos.
  const sustituida = (m.source_metadata as { supersedes?: string | null } | null)?.supersedes;
  if (sustituida) {
    await svc
      .from('memories')
      .update({ status: 'active' })
      .eq('id', sustituida)
      .eq('user_id', userId)
      .eq('status', 'superseded');
  }

  const { data: cancelados } = await svc
    .from('events')
    .update({ status: 'cancelled' })
    .eq('linked_memory_id', m.id)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .select('id');

  const resumen = enSegundaPersona((m.summary || '').replace(/\s+/g, ' '))
    .slice(0, 200)
    .replace(/[.\s]+$/, '');
  const avisos = cancelados?.length ? ' Y he quitado el aviso que tenía programado.' : '';
  return `Hecho, lo he olvidado${resumen ? `: «${resumen}»` : ''}.${avisos}`;
}
