// =====================================================
// POST /api/assistant — chat del modo Silvestre (una sola ventana)
//
// Una sola caja de texto sirve para todo, sin modos:
//   - «apunta que…» / «recuérdame…» → se guarda y se confirma.
//   - pregunta → MOTOR DE DATOS (ventas, mercados, proveedores) y MEMORIA
//     (lo que el usuario haya contado) se buscan EN PARALELO; si el motor de
//     datos contesta, manda él; si no, responde la memoria.
//
// Pantalla del directivo (2026-10-20, propuesta Silvestre Fase 0):
//   - Plazo cerrado de 50 s por pregunta: o hay respuesta o hay un código de
//     error claro (nunca una espera infinita).
//   - Códigos: ok | busy (servicio saturado) | timeout | session | internal.
//     El cliente los traduce a lenguaje llano con botón «Reintentar».
//   - Estilo «simple»: respuesta corta primero y el detalle tras ---detalle---;
//     las marcas [n] se quitan y las fuentes llegan con etiqueta llana.
//   - Temas excluidos (EXCLUDED_TOPICS_*): ni se guardan ni se responden.
//
// Body: { pregunta: string, historial?: [{role, content}], reintento?: boolean }
// Devuelve: { code:'ok', answer, kind, fuentes? } | { code, error } (4xx/5xx)
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/auth/admin';
import { responderPreguntaDatos, type TurnoChat } from '@/lib/datos/qa';
import { synthesizeAnswer } from '@/lib/answer/synthesize';
import {
  clasificarIntencion,
  capturarTurno,
  confirmacionRegistro,
  cuandoLlano,
} from '@/lib/assistant/registro';
import { prepararRespuestaSimple, type FuenteSimple } from '@/lib/assistant/citas';
import { registrarEvento, type CodigoAsistente } from '@/lib/assistant/eventos';
import { comprobarExclusion } from '@/lib/ingestion/exclusions';
import { ingest } from '@/lib/ingestion/pipeline';
import { leerFoto, type LecturaFoto } from '@/lib/assistant/foto';
import { esPeticionOlvidar, olvidarUltimo } from '@/lib/assistant/olvidar';
import type { IngestionResult } from '@/types/domain';
import { waitUntil } from '@vercel/functions';

export const runtime = 'nodejs';
// 150 s (Fluid Compute ON): da margen al guardado en segundo plano (waitUntil),
// que comparte el reloj de la función. La respuesta al usuario sale en ≤50 s.
export const maxDuration = 150;

/** Plazo de la RESPUESTA (el cliente aborta a los 55 s). */
const PLAZO_MS = 50_000;

const Schema = z
  .object({
    pregunta: z.string().max(2000).default(''),
    historial: z
      .array(z.object({ role: z.string(), content: z.string() }))
      .max(20)
      .optional(),
    /** true = el usuario pulsó «Reintentar»: el turno ya se guardó la 1.ª vez. */
    reintento: z.boolean().optional(),
    /** Foto JPEG en base64 (sin prefijo data:), ya reducida en el móvil. */
    imagen: z.string().max(3_500_000).optional(),
    /** Texto de la foto de hace un momento, para preguntas de seguimiento. */
    contextoFoto: z
      .object({ descripcion: z.string().max(600), ocr_text: z.string().max(8000) })
      .optional(),
  })
  .refine((b) => b.pregunta.trim().length > 0 || !!b.imagen, { message: 'pregunta vacía' });

type Captura = { ok: true; result: IngestionResult } | { ok: false; result: null };

interface Respuesta {
  answer: string;
  kind: 'registro' | 'datos' | 'memoria' | 'excluido' | 'foto';
  grounded?: boolean;
  fuentes?: FuenteSimple[];
  /** Solo fotos: texto leído (para seguir preguntando) y aviso que ofrecer. */
  foto?: { descripcion: string; ocr_text: string };
  evento?: { titulo: string; fecha_iso: string; todo_el_dia: boolean; cuando: string } | null;
}

class PlazoAgotado extends Error {}

function clasificarError(e: unknown): Exclude<CodigoAsistente, 'ok'> {
  if (e instanceof PlazoAgotado) return 'timeout';
  const msg = String((e as Error)?.message ?? e).toLowerCase();
  if (/deadline|timeout|timed out|abort/.test(msg)) return 'timeout';
  if (/\((429|502|503|529)\)|openrouter (429|502|503|529)|rate.?limit|overloaded|saturad/.test(msg)) return 'busy';
  return 'internal';
}

const ESTADO: Record<Exclude<CodigoAsistente, 'ok'>, number> = {
  busy: 503,
  timeout: 504,
  internal: 500,
};

export async function POST(req: Request) {
  const t0 = Date.now();
  const deadlineMs = t0 + PLAZO_MS;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ code: 'session', error: 'session' }, { status: 401 });
  }

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { code: 'internal', error: 'invalid_body', detail: String(e).slice(0, 300) },
      { status: 400 }
    );
  }

  const svc = createServiceClient();
  const evento = (kind: string, code: CodigoAsistente, detail?: string) =>
    waitUntil(registrarEvento(svc, { userId: user.id, kind, code, ms: Date.now() - t0, detail }));

  const pregunta = body.pregunta.trim();
  // Los turnos del asistente pueden ser largos: al prompt solo le hace falta
  // el arranque de cada uno para resolver «¿y su hermano?».
  const historial: TurnoChat[] = (body.historial ?? []).slice(-6).map((t) => ({
    role: t.role,
    content: t.content.slice(0, 1200),
  })) as TurnoChat[];

  // 0.a) «Olvida lo último»: se retira lo último guardado desde el chat y esta
  //      petición no se guarda.
  if (!body.imagen && esPeticionOlvidar(pregunta)) {
    try {
      const answer = await olvidarUltimo(svc, user.id);
      evento('olvidar', 'ok');
      return NextResponse.json({ code: 'ok', kind: 'registro', answer });
    } catch (e) {
      evento('error', 'internal', String((e as Error)?.message ?? e));
      return NextResponse.json({ code: 'internal', error: 'internal' }, { status: 500 });
    }
  }

  // 0.b) Tema excluido por el usuario: ni se guarda ni se responde.
  if (pregunta && comprobarExclusion(pregunta).excluded) {
    const intencionEx = await clasificarIntencion(pregunta);
    evento('excluido', 'ok');
    return NextResponse.json({
      code: 'ok',
      kind: 'excluido',
      excluded: true,
      answer:
        intencionEx === 'registro'
          ? 'Entendido, pero este asunto no lo guardo.'
          : 'De ese asunto no guardo nada, así que no puedo ayudarte con él.',
    });
  }

  // 1) CAPTURA-TODO (decisión 2026-09-08): TODO turno del usuario se guarda
  //    como memoria; el clasificador solo da forma a la respuesta. Corre en
  //    paralelo con la respuesta y termina en segundo plano (waitUntil), por
  //    eso usa un cliente de SERVICIO (sin cookies) con user.id explícito.
  //    En un «Reintentar» la pregunta ya se guardó la primera vez: no se
  //    vuelve a capturar (salvo que sea un registro, que se confirma abajo).
  const lanzarCaptura = (): Promise<Captura> =>
    capturarTurno(svc, user.id, pregunta).then(
      (result) => ({ ok: true as const, result }),
      () => ({ ok: false as const, result: null })
    );
  // Con foto, la pregunta se guarda DENTRO de la memoria de la foto.
  let captura: Promise<Captura> | null =
    body.reintento || body.imagen ? null : lanzarCaptura();
  let guardadoFoto: Promise<unknown> | null = null;

  const datosAllowed = isAdmin(user) || user.app_metadata?.datos_access === true;

  const responderFoto = async (imagen: string): Promise<Respuesta> => {
    const b64 = imagen.replace(/^data:image\/[a-z]+;base64,/, '');
    const lectura = await leerFoto(b64, pregunta, deadlineMs);
    if (comprobarExclusion(pregunta, lectura.descripcion, lectura.ocr_text).excluded) {
      return { kind: 'excluido', answer: 'Esta foto toca un asunto que no guardo, así que no la he archivado.' };
    }
    // Archivo + memoria en segundo plano: el usuario ya tiene su respuesta.
    if (!body.reintento) guardadoFoto = guardarFoto(svc, user.id, b64, lectura, pregunta);
    return {
      kind: 'foto',
      answer: lectura.respuesta,
      foto: { descripcion: lectura.descripcion, ocr_text: lectura.ocr_text.slice(0, 6000) },
      evento: lectura.evento
        ? {
            ...lectura.evento,
            cuando: cuandoLlano({ due_at: lectura.evento.fecha_iso, all_day: lectura.evento.todo_el_dia }),
          }
        : null,
    };
  };

  const responder = async (): Promise<Respuesta> => {
    if (body.imagen) return responderFoto(body.imagen);
    // (clasificarIntencion nunca lanza: ante fallo devuelve 'consulta')
    const intencion = await clasificarIntencion(pregunta);

    // Pidió registrar → la respuesta ES la confirmación. Si el guardado
    // falló se DICE: jamás fingir que se guardó.
    if (intencion === 'registro') {
      if (!captura) captura = lanzarCaptura();
      const [c, dispositivos] = await Promise.all([
        captura,
        svc
          .from('push_subscriptions')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .then((r) => r.count ?? null, () => null),
      ]);
      return {
        kind: 'registro',
        answer: c.ok
          ? confirmacionRegistro(c.result, {
              texto: pregunta,
              tieneAvisos: dispositivos === null ? undefined : dispositivos > 0,
            })
          : 'Te he entendido, pero no he podido guardarlo ahora mismo. Vuelve a enviármelo en un momento, por favor.',
      };
    }

    // Datos y memoria a la vez: la espera es la del más lento, no la suma.
    const [datos, memoria] = await Promise.allSettled([
      datosAllowed
        ? responderPreguntaDatos(svc, pregunta, historial, user.id, { estilo: 'simple', deadlineMs })
        : Promise.resolve(null),
      synthesizeAnswer(supabase, user.id, pregunta, {
        estilo: 'simple',
        historial,
        deadlineMs,
        fotoReciente: body.contextoFoto ?? null,
      }),
    ]);

    const textoDatos = datos.status === 'fulfilled' ? datos.value : null;
    const mem = memoria.status === 'fulfilled' ? memoria.value : null;
    // «No he podido calcular eso…» (SQL fallido) cede ante una memoria que sí sabe.
    const datosFallidos = !!textoDatos && textoDatos.startsWith('No he podido calcular');

    if (textoDatos && !(datosFallidos && mem?.grounded)) {
      return { kind: 'datos', answer: textoDatos };
    }
    if (mem) {
      const { answer, fuentes } = prepararRespuestaSimple(mem.answer_md, mem.sources);
      return { kind: 'memoria', answer, grounded: mem.grounded, fuentes };
    }
    throw (memoria as PromiseRejectedResult).reason;
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const payload = await Promise.race([
      responder(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new PlazoAgotado('plazo agotado')), PLAZO_MS);
      }),
    ]);
    evento(payload.kind, 'ok');
    return NextResponse.json({ code: 'ok', ...payload });
  } catch (e) {
    const code = clasificarError(e);
    evento('error', code, String((e as Error)?.message ?? e));
    return NextResponse.json({ code, error: code }, { status: ESTADO[code] });
  } finally {
    clearTimeout(timer);
    // La ingesta del turno termina en SEGUNDO PLANO: no bloquea la respuesta.
    if (captura) waitUntil(captura);
    if (guardadoFoto) waitUntil(guardadoFoto);
  }
}

/** Sube la foto al bucket privado y la guarda como memoria (con su texto). */
async function guardarFoto(
  svc: ReturnType<typeof createServiceClient>,
  userId: string,
  b64: string,
  lectura: LecturaFoto,
  pregunta: string
): Promise<void> {
  let storagePath: string | null = `${userId}/asistente/${crypto.randomUUID()}.jpg`;
  try {
    const { error } = await svc.storage
      .from('lexis-raw')
      .upload(storagePath, Buffer.from(b64, 'base64'), { contentType: 'image/jpeg', upsert: false });
    if (error) throw error;
  } catch (e) {
    console.error('[assistant] no se pudo archivar la foto', e);
    storagePath = null;
  }
  const raw = [
    pregunta ? `Pregunta del usuario sobre la foto: ${pregunta}` : '',
    lectura.descripcion ? `Foto: ${lectura.descripcion}` : 'Foto enviada desde el chat',
    lectura.ocr_text ? `Texto de la foto:\n${lectura.ocr_text}` : '',
    `Lo que le respondí: ${lectura.respuesta.replace('---detalle---', '').slice(0, 1500)}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  try {
    await ingest(svc, userId, {
      source_type: 'image',
      raw_text: raw,
      source_uri: storagePath ? `storage://lexis-raw/${storagePath}` : undefined,
      source_metadata: {
        via: 'asistente-foto',
        storage_path: storagePath,
        caption_raw: { description: lectura.descripcion, ocr_text: lectura.ocr_text },
      },
    });
  } catch (e) {
    console.error('[assistant] no se pudo guardar la memoria de la foto', e);
  }
}
