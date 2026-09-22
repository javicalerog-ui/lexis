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
  '^\\s*(ap[uú]nta(me)?|anota(me)?|recuerda\\s+que|acu[eé]rdate\\s+de\\s+que|' +
    'toma\\s+nota|guarda(me)?\\s|registra(me)?\\s|quiero\\s+(registrar|anotar|apuntar)|' +
    'recu[eé]rdame\\s)',
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
- Solo "registro" si claramente aporta información para guardar.
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
  });
}

/** Redacta la confirmación visible cuando el usuario pidió registrar. */
export function confirmacionRegistro(result: IngestionResult): string {
  if (result.decision === 'redundant') {
    return 'Eso ya lo tenía anotado de antes, así que no lo he duplicado. Si quieres matizarlo o añadir algo nuevo, dímelo.';
  }

  const partes: string[] = [];
  partes.push(
    result.decision === 'modification'
      ? 'Anotado — he actualizado lo que ya tenía sobre esto:'
      : 'Anotado:'
  );
  if (result.summary) partes.push(`**${result.summary.trim()}**`);

  const proyectos = (result.attached_projects || []).map((p) => p.name).filter(Boolean);
  const entidades = (result.attached_entities || []).map((e) => e.name).filter(Boolean);
  // Dedupe: un mismo nombre (p.ej. "Lexis") puede venir como proyecto Y como
  // entidad a la vez — sin esto salía repetido en la confirmación.
  const vistos = new Set<string>();
  const etiquetas = [...proyectos, ...entidades].filter((nombre) => {
    const clave = nombre.toLowerCase();
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });
  if (etiquetas.length > 0) {
    partes.push(`Lo he relacionado con: ${etiquetas.join(', ')}.`);
  }

  return partes.join('\n\n');
}
