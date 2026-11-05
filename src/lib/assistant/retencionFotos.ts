// =====================================================
// Retención de las fotos del chat del asistente (propuesta Silvestre, 1.1 y
// decisión 8: «90 días + texto»)
//
// Son documentos de dirección: el FICHERO no se guarda para siempre. El texto
// leído vive en la memoria y sigue contestando «¿cuánto era aquella factura?».
//   - caducada: más de 90 días → se borra el fichero; la memoria se queda.
//   - huérfana: sin memoria viva (guardado fallido, foto repetida, memoria
//     borrada por el usuario) → se borra con 24 h de margen, porque la memoria
//     se guarda en segundo plano y puede ir por detrás del fichero.
// Solo toca <uid>/asistente/: lo demás de lexis-raw (voz, importaciones) no.
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'lexis-raw';
const DIA_MS = 86_400_000;
export const RETENCION_DIAS = 90;
const MARGEN_HUERFANA_MS = DIA_MS;
const LOTE = 100;

export type MotivoBorrado = 'caducada' | 'huerfana';

export function motivoBorrado(
  creadaEn: string,
  estadoMemoria: string | null,
  ahora: number
): MotivoBorrado | null {
  const edad = ahora - new Date(creadaEn).getTime();
  // Fecha ilegible: mejor conservar que borrar a ciegas.
  if (!Number.isFinite(edad)) return null;
  if (edad >= RETENCION_DIAS * DIA_MS) return 'caducada';
  if (edad < MARGEN_HUERFANA_MS) return null;
  return estadoMemoria === null || estadoMemoria === 'deleted' ? 'huerfana' : null;
}

export interface ResultadoLimpieza {
  revisadas: number;
  caducadas: number;
  huerfanas: number;
  errores: number;
}

export async function limpiarFotos(
  svc: SupabaseClient,
  userIds: string[],
  ahora = Date.now()
): Promise<ResultadoLimpieza> {
  const r: ResultadoLimpieza = { revisadas: 0, caducadas: 0, huerfanas: 0, errores: 0 };
  for (const uid of userIds) {
    const carpeta = `${uid}/asistente`;
    const objetos: Array<{ path: string; creadaEn: string }> = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await svc.storage.from(BUCKET).list(carpeta, { limit: 1000, offset });
      if (error) {
        console.error('[retencionFotos] no se pudo listar', uid, error.message);
        r.errores++;
        break;
      }
      for (const o of data ?? []) {
        if (o.id && o.created_at) objetos.push({ path: `${carpeta}/${o.name}`, creadaEn: o.created_at });
      }
      if ((data ?? []).length < 1000) break;
    }

    for (let i = 0; i < objetos.length; i += LOTE) {
      const lote = objetos.slice(i, i + LOTE);
      r.revisadas += lote.length;
      const { data: memorias, error } = await svc
        .from('memories')
        .select('id, status, source_metadata')
        .eq('user_id', uid)
        .in(
          'source_metadata->>storage_path',
          lote.map((o) => o.path)
        );
      // Sin saber qué memorias hay, todo parecería huérfano: no se borra nada.
      if (error) {
        console.error('[retencionFotos] no se pudieron leer las memorias', uid, error.message);
        r.errores++;
        continue;
      }
      const porRuta = new Map(
        (memorias ?? []).map((m) => [(m.source_metadata as { storage_path?: string }).storage_path, m])
      );

      const borrar: string[] = [];
      const motivos: MotivoBorrado[] = [];
      for (const o of lote) {
        const mem = porRuta.get(o.path);
        const motivo = motivoBorrado(o.creadaEn, mem?.status ?? null, ahora);
        if (!motivo) continue;
        // Primero se quita la referencia: si luego falla el borrado, el fichero
        // queda huérfano y la siguiente pasada lo recoge.
        if (mem) {
          const { error: e2 } = await svc
            .from('memories')
            .update({
              source_uri: null,
              source_metadata: {
                ...(mem.source_metadata as Record<string, unknown>),
                storage_path: null,
                foto_borrada_at: new Date(ahora).toISOString(),
              },
            })
            .eq('id', mem.id)
            .eq('user_id', uid);
          if (e2) {
            console.error('[retencionFotos] no se pudo actualizar la memoria', mem.id, e2.message);
            r.errores++;
            continue;
          }
        }
        borrar.push(o.path);
        motivos.push(motivo);
      }
      if (!borrar.length) continue;

      const { error: e3 } = await svc.storage.from(BUCKET).remove(borrar);
      if (e3) {
        console.error('[retencionFotos] no se pudieron borrar', uid, e3.message);
        r.errores++;
        continue;
      }
      for (const m of motivos) {
        if (m === 'caducada') r.caducadas++;
        else r.huerfanas++;
      }
    }
  }
  return r;
}
