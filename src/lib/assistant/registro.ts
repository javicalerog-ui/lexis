// =====================================================
// Registro desde el chat del asistente (modo Silvestre)
//
// Una sola caja de texto para todo: además de PREGUNTAR (datos o memoria),
// el usuario puede REGISTRAR ("apunta que...", "recuerda que...") y eso se
// guarda como memoria por el MISMO pipeline que la pantalla Capturar
// (resumen LLM + embedding + dedupe + proyectos/entidades + eventos).
//
// Clasificación en dos cintas, sesgada a lo seguro:
//   1. Heurística: interrogaciones/interrogativos → consulta;
//      verbos imperativos de registro al inicio → registro.
//   2. LLM (fast) solo para lo ambiguo. En caso de duda o fallo → consulta
//      (nunca guardamos nada por accidente; responder de más es inocuo,
//      escribir de más no).
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { chat } from '@/lib/llm/escalation';
import { ingest } from '@/lib/ingestion/pipeline';

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
      max_tokens: 30,
    });
    const parsed = JSON.parse(res.text.trim().replace(/^```json\s*|\s*```$/g, ''));
    return parsed?.intencion === 'registro' ? 'registro' : 'consulta';
  } catch {
    // Fallo del LLM → tratamos como consulta (no escribir por accidente).
    return 'consulta';
  }
}

// --- Captura + confirmación ------------------------------------------------

export async function capturarRegistro(
  supabase: SupabaseClient,
  userId: string,
  texto: string
): Promise<string> {
  const result = await ingest(supabase, userId, {
    source_type: 'text',
    raw_text: texto,
    source_metadata: { via: 'asistente' },
  });

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
  const etiquetas = [...proyectos, ...entidades];
  if (etiquetas.length > 0) {
    partes.push(`Lo he relacionado con: ${etiquetas.join(', ')}.`);
  }

  return partes.join('\n\n');
}
