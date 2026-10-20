// =====================================================
// Foto desde el chat del asistente (propuesta Silvestre, Fase 1)
//
// UNA sola llamada de visión hace todo lo que el usuario espera al instante:
//   - responde a su pregunta sobre la foto (o, sin pregunta, dice qué es y lo
//     importante), en estilo directivo: corto + ---detalle---;
//   - transcribe el texto legible (OCR), que se guarda con la memoria para
//     poder preguntar después por cualquier dato de la foto;
//   - detecta si muestra una cita o fecha futura concreta, para OFRECER un
//     aviso (Sí/No): nunca se crea un recordatorio sin que el usuario lo diga.
//
// La imagen viaja en base64 (ya reducida en el móvil a ≤2048 px) y se envía a
// proveedores sin retención de datos (provider.zdr). El guardado en Storage y
// la memoria se hacen en segundo plano desde el route.
// =====================================================

import { callOpenRouter, visionModel } from '@/lib/llm/openrouter';

export interface LecturaFoto {
  respuesta: string;
  descripcion: string;
  ocr_text: string;
  evento: { titulo: string; fecha_iso: string; todo_el_dia: boolean } | null;
}

function hoyMadrid(): string {
  return new Date().toLocaleString('es-ES', {
    timeZone: 'Europe/Madrid',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const PROMPT = (pregunta: string) => `Eres Lexis, el asistente personal de un directivo. Te envía una foto hecha con el móvil (documento, pantalla, tarjeta, factura, pizarra, producto, invitación…).
Hoy es ${hoyMadrid()} (hora de Madrid).
${pregunta ? `Su pregunta sobre la foto: «${pregunta.replaceAll('»', '"')}»` : 'No ha escrito ninguna pregunta.'}

Devuelve SOLO un JSON con esta forma:
{"respuesta": "...", "descripcion": "...", "ocr_text": "...", "evento": null}

- "respuesta": lo que verá en pantalla. Si hay pregunta, respóndela con lo que se ve en la foto. Si no la hay, di en 1-2 frases qué es y lo más importante (importes, fechas, nombres, plazos). Empieza por lo esencial en 1-3 frases cortas; si hay más datos útiles, añade una línea que sea exactamente ---detalle--- y debajo una lista corta con "- ". Español llano, sin jerga. NO inventes: si algo no se lee bien, dilo.
- "descripcion": una frase neutra de qué es la foto (para archivarla).
- "ocr_text": TODO el texto legible de la foto, literal y en orden de lectura (máximo unos 6000 caracteres). Cadena vacía si no hay texto.
- "evento": SOLO si la foto muestra una cita, reunión, viaje o vencimiento con una fecha FUTURA concreta, {"titulo": "breve", "fecha_iso": "AAAA-MM-DDTHH:MM:00+02:00 (con el desfase horario de Madrid de esa fecha)", "todo_el_dia": true/false}. Si no hay hora, todo_el_dia=true y usa las 09:00. Si no hay fecha futura clara, null.`;

export async function leerFoto(
  imagenBase64: string,
  pregunta: string,
  deadlineMs: number
): Promise<LecturaFoto> {
  const res = await callOpenRouter({
    model: visionModel(),
    temperature: 0.2,
    max_tokens: 4000,
    response_format: { type: 'json_object' },
    provider: { zdr: true },
    deadlineMs,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: PROMPT(pregunta) },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imagenBase64}` } },
        ],
      },
    ],
  });

  const limpio = res.text.trim().replace(/^```json\s*|\s*```$/g, '');
  let j: Partial<LecturaFoto>;
  try {
    j = JSON.parse(limpio);
  } catch {
    // Sin JSON válido: si el modelo contestó en texto, eso es la respuesta.
    if (limpio && !limpio.startsWith('{')) {
      return { respuesta: limpio, descripcion: '', ocr_text: '', evento: null };
    }
    throw new Error('La lectura de la foto no devolvió un resultado válido');
  }

  const respuesta = String(j.respuesta ?? '').trim();
  if (!respuesta) throw new Error('El modelo devolvió una respuesta vacía para la foto');

  let evento: LecturaFoto['evento'] = null;
  if (j.evento && typeof j.evento === 'object' && j.evento.fecha_iso) {
    const t = new Date(j.evento.fecha_iso).getTime();
    // Solo fechas futuras (con 1 h de margen) y razonables (≤ 2 años).
    if (!isNaN(t) && t > Date.now() - 3_600_000 && t < Date.now() + 730 * 86_400_000) {
      evento = {
        titulo: String(j.evento.titulo || 'Cita de la foto').slice(0, 120),
        fecha_iso: new Date(t).toISOString(),
        todo_el_dia: !!j.evento.todo_el_dia,
      };
    }
  }

  return {
    respuesta,
    descripcion: String(j.descripcion ?? '').slice(0, 500),
    ocr_text: String(j.ocr_text ?? '').slice(0, 8000),
    evento,
  };
}
