// =====================================================
// Fuentes «en lenguaje llano» para la pantalla del directivo
//
// La síntesis sigue citando [n] (así sabemos de qué memoria sale cada dato),
// pero en /asistente el usuario no debe ver corchetes ni «notas»: aquí se
// quitan las marcas del texto, se conservan solo las fuentes CITADAS de verdad
// y a cada una se le pone una etiqueta comprensible:
//   «Me lo contaste el 3 de octubre» · «Lo sé por tu ficha: Familia»
//   «Lo sé por la ficha del proyecto UNDORA» · «Lo leí en una foto del 3 de oct.»
// =====================================================

import type { AnswerSource } from '@/lib/answer/synthesize';

export interface FuenteSimple {
  etiqueta: string;
  texto: string;
  fecha: string;
  tipo: 'foto' | 'ficha' | 'proyecto' | 'nota';
  /** Ruta del objeto en Storage (solo fotos), para pedir la miniatura. */
  imagen_path?: string | null;
  memory_id: string;
}

const MARCA = /\s?\[(\d+(?:\s*[,y]\s*\d+)*)\]/g;
const PREFIJO_FICHA = /^\[(?:Ficha de|Contexto de empresa)[^\]]*\]\s*/;

function fechaLarga(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'long',
      timeZone: 'Europe/Madrid',
    });
  } catch {
    return '';
  }
}

export function prepararRespuestaSimple(
  answer: string,
  sources: AnswerSource[]
): { answer: string; fuentes: FuenteSimple[] } {
  const citadas = new Set<number>();
  for (const m of answer.matchAll(MARCA)) {
    for (const n of m[1].split(/\s*[,y]\s*/)) citadas.add(Number(n));
  }
  const limpio = answer.replace(MARCA, '').replace(/[ \t]+\n/g, '\n').trim();

  const fuentes: FuenteSimple[] = [];
  sources.forEach((s, i) => {
    if (!citadas.has(i + 1)) return;
    const md = (s.source_metadata ?? {}) as Record<string, unknown>;
    const resumen = (s.summary || '').trim();
    const fecha = fechaLarga(s.captured_at);
    const imagenPath = typeof md.storage_path === 'string' ? md.storage_path : null;

    if (s.source_type === 'image' || imagenPath) {
      fuentes.push({
        etiqueta: `Lo leí en una foto del ${fecha}`,
        texto: resumen,
        fecha,
        tipo: 'foto',
        imagen_path: imagenPath,
        memory_id: s.id,
      });
    } else if (md.origen === 'ficha-referencia' || PREFIJO_FICHA.test(resumen)) {
      const seccion = typeof md.seccion === 'string' ? md.seccion : 'datos de referencia';
      fuentes.push({
        etiqueta: `Lo sé por tu ficha: ${seccion}`,
        texto: resumen.replace(PREFIJO_FICHA, ''),
        fecha,
        tipo: 'ficha',
        memory_id: s.id,
      });
    } else if (md.kind === 'project') {
      const titulo = typeof md.title === 'string' ? md.title : 'un proyecto';
      fuentes.push({
        etiqueta: `Lo sé por la ficha del proyecto ${titulo}`,
        texto: resumen,
        fecha,
        tipo: 'proyecto',
        memory_id: s.id,
      });
    } else {
      fuentes.push({
        etiqueta: `Me lo contaste el ${fecha}`,
        texto: resumen,
        fecha,
        tipo: 'nota',
        memory_id: s.id,
      });
    }
  });

  return { answer: limpio, fuentes };
}
