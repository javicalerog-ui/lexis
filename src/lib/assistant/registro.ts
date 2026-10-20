// =====================================================
// Registro desde el chat del asistente (modo Silvestre)
//
// CAPTURA-TODO (decisión 2026-09-08): el clasificador NUNCA decide si un
// mensaje se guarda — TODO turno del usuario se ingesta por el MISMO pipeline
// que Capturar (resumen LLM + embedding + dedupe + proyectos/entidades +
// eventos). Un fallo de clasificación degrada el etiquetado o la respuesta,
// jamás la recuperabilidad: nada de lo que se diga queda fuera de la memoria.
// El dedupe del pipeline se encarga del ruido (preguntas triviales →
// 'redundant'/'unclear', no ensucian).
//
// La clasificación registro/consulta sirve SOLO para dar forma a la
// respuesta: si pidió registrar explícitamente («apunta que...»), la
// respuesta es la confirmación «Anotado» (siempre visible); si preguntó,
// la respuesta sale del motor de datos o de la memoria.
//   1. Heurística: interrogaciones/interrogativos → consulta;
//      verbos imperativos de registro al inicio → registro.
//   2. LLM (fast) solo para lo ambiguo; en duda o fallo → consulta.
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { chat } from '@/lib/llm/escalation';
import { ingest } from '@/lib/ingestion/pipeline';
import type { IngestionResult } from '@/types/domain';

export type Intencion = 'registro' | 'consulta';

// --- Cinta 1: heurística barata -------------------------------------------

const RX_REGISTRO = new RegExp(
  '^\\s*(ap[uú]nta(me|lo)?|anota(me|lo)?|recuerda\\s+que|acu[eé]rdate\\s+de\\s+que|' +
    'toma\\s+nota|guarda(me|lo)?\\s|registra(me|lo)?\\s|quiero\\s+(registrar|anotar|apuntar)|' +
    // Recordatorios/alarmas: pronombre pegado ("recuérdamelo"), "avísame",
    // "ponme un recordatorio". Cubre el caso "recuérdamelo a las 15h, ok??"
    // que antes caía en consulta por acabar en "?".
    'recu[eé]rda(melo|nos|los|las|me|lo|la)?\\b|av[ií]sa(me|nos)?\\b|' +
    'p[oó]n(me)?\\s+(un|una)?\\s*(recordatorio|alarma|aviso))',
  'i'
);

const RX_CONSULTA = new RegExp(
  '^\\s*[¿]|\\?\\s*$|' +
    '^\\s*(qu[eé]|cu[aá]nt[oa]s?|cu[aá]l(es)?|c[oó]mo|d[oó]nde|cu[aá]ndo|qui[eé]n(es)?|' +
    'dime|dame|mu[eé]strame|ens[eé]ñame|lista|comp[aá]rame|busca|hay\\s)',
  'i'
);

export function clasificarHeuristica(texto: string): Intencion | null {
  if (RX_REGISTRO.test(texto)) return 'registro';
  if (RX_CONSULTA.test(texto)) return 'consulta';
  return null;
}

// --- Cinta 2: LLM para lo ambiguo -----------------------------------------

const CLASIFICAR_PROMPT = `Eres el enrutador de un asistente personal. Decide si el mensaje del usuario es:

- "registro": el usuario quiere GUARDAR información (una nota, un hecho nuevo que cuenta, algo que recordar). Suele ser una afirmación con información propia, no una petición de datos.
- "consulta": el usuario quiere OBTENER una respuesta (pregunta, petición de cifras, búsqueda en su memoria).

Reglas:
- Cualquier pregunta (aunque no lleve "¿") es "consulta".
- Peticiones de cifras de negocio (ventas, cuota, precios, proveedores, países) son SIEMPRE "consulta".
- Saludos, agradecimientos o conversación social → "consulta".
- Peticiones de RECORDATORIO o ALARMA ("recuérdame…", "recuérdamelo a las 15h", "avísame cuando…", "ponme un recordatorio", "no se me olvide…"), aunque acaben en "?", son "registro". Lexis SÍ puede programar recordatorios y avisar por notificación push: nunca respondas que no puedes.
- Solo "registro" si claramente aporta información para guardar o pide recordar/avisar algo.
- EN CASO DE DUDA → "consulta".

Responde SOLO JSON: {"intencion":"registro"} o {"intencion":"consulta"}`;

export async function clasificarIntencion(texto: string): Promise<Intencion> {
  const heuristica = clasificarHeuristica(texto);
  if (heuristica) return heuristica;
  try {
    const res = await chat(texto.slice(0, 1500), {
      system: CLASIFICAR_PROMPT,
      tier: 'fast',
      json: true,
      temperature: 0,
      // El modelo razona de forma obligatoria (~400 tokens) antes de la salida:
      // con 30 el JSON nunca cabía y el clasificador LLM quedaba muerto (caía
      // siempre al default 'consulta'). Con margen sí clasifica los casos
      // ambiguos que la heurística no cubre.
      max_tokens: 600,
    });
    const parsed = JSON.parse(res.text.trim().replace(/^```json\s*|\s*```$/g, ''));
    return parsed?.intencion === 'registro' ? 'registro' : 'consulta';
  } catch {
    // Fallo del LLM → tratamos como consulta (no escribir por accidente).
    return 'consulta';
  }
}

// --- Captura + confirmación ------------------------------------------------

/** Ingesta un turno del chat como memoria (pipeline completo de Capturar). */
export function capturarTurno(
  supabase: SupabaseClient,
  userId: string,
  texto: string
): Promise<IngestionResult> {
  return ingest(supabase, userId, {
    source_type: 'text',
    raw_text: texto,
    source_metadata: { via: 'asistente' },
  }).catch(async (e) => {
    // Un guardado fallido NO puede perderse en silencio (corre en segundo
    // plano): queda en ingestion_log con status='failed' para reintentarlo.
    try {
      await supabase.from('ingestion_log').insert({
        user_id: userId,
        input_excerpt: texto.slice(0, 500),
        status: 'failed',
        error_message: String((e as Error)?.message ?? e).slice(0, 500),
      });
    } catch {
      // ni el log: solo consola
    }
    console.error('[asistente] captura fallida', e);
    throw e;
  });
}

// «recuérdame», «avísame», «ponme una alarma»…: el usuario espera un AVISO.
const RX_PIDE_AVISO = /recu[eé]rda(me|melo|nos)|av[ií]sa(me|nos)|alarma|recordatorio|aviso|no se me olvide/i;

/** «el martes 21 de octubre a las 9:00» en la zona del usuario. */
export function cuandoLlano(ev: { due_at: string; all_day: boolean; timezone?: string }): string {
  const tz = ev.timezone || 'Europe/Madrid';
  const d = new Date(ev.due_at);
  const dia = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz });
  if (ev.all_day) return `el ${dia}`;
  const hora = d.toLocaleTimeString('es-ES', { hour: 'numeric', minute: '2-digit', timeZone: tz });
  return `el ${dia} a las ${hora}`;
}

/** Redacta la confirmación visible cuando el usuario pidió registrar. */
export function confirmacionRegistro(
  result: IngestionResult,
  opts: { texto?: string; tieneAvisos?: boolean } = {}
): string {
  if (result.decision === 'excluded') {
    return 'Entendido, pero este asunto no lo guardo.';
  }
  if (result.decision === 'redundant') {
    return 'Eso ya lo tenía apuntado de antes, así que no lo he duplicado. Si quieres matizarlo o añadir algo nuevo, dímelo.';
  }

  // Sin jerga (2026-10-20): ni «Anotado» ni «Lo he relacionado con: …» —
  // las relaciones con proyectos/entidades son detalle interno.
  const partes: string[] = [];
  partes.push(
    result.decision === 'modification'
      ? 'Apuntado. He actualizado lo que ya tenía sobre esto:'
      : 'Apuntado:'
  );
  if (result.summary) partes.push(`**${result.summary.trim()}**`);

  // Avisos (L-11): decir CUÁNDO llegará; si pidió un aviso y no se entendió la
  // fecha, decirlo en vez de dejarle creer que habrá aviso.
  const eventos = result.events_created ?? [];
  if (eventos.length === 1) {
    partes.push(`Te avisaré ${cuandoLlano(eventos[0])}.`);
  } else if (eventos.length > 1) {
    partes.push(
      'Te avisaré:\n' + eventos.slice(0, 5).map((e) => `- ${e.title}: ${cuandoLlano(e)}`).join('\n')
    );
  } else if (opts.texto && RX_PIDE_AVISO.test(opts.texto)) {
    partes.push('No he entendido para cuándo quieres el aviso. Dime el día y la hora, por ejemplo: «recuérdamelo mañana a las 9».');
  }
  if (eventos.length > 0 && opts.tieneAvisos === false) {
    partes.push('Para que el aviso te llegue al teléfono, toca «Activar avisos» arriba.');
  }
  return partes.join('\n\n');
}
