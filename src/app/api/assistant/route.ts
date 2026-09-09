// =====================================================
// POST /api/assistant — chat del modo Silvestre (una sola ventana)
//
// Enrutado sencillo y robusto: intenta primero responder con el MOTOR DE DATOS
// (ventas, ASCER/Confindustria, proveedores...). Si la pregunta no es de datos,
// el motor devuelve null y caemos a la MEMORIA (síntesis RAG sobre lo que el
// usuario haya guardado). Así una sola caja de texto sirve para todo, sin modos.
//
// Body: { pregunta: string, historial?: [{role, content}] }
// Devuelve: { answer: string, kind: 'datos' | 'memoria' }
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
} from '@/lib/assistant/registro';

export const runtime = 'nodejs';
export const maxDuration = 60;

const Schema = z.object({
  pregunta: z.string().min(1).max(2000),
  historial: z
    .array(z.object({ role: z.string(), content: z.string() }))
    .max(20)
    .optional(),
});

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: 'invalid_body', detail: String(e) }, { status: 400 });
  }

  const datosAllowed = isAdmin(user) || user.app_metadata?.datos_access === true;

  // 0) CAPTURA-TODO (decisión 2026-09-08): TODO turno del usuario se guarda
  //    como memoria — el clasificador NUNCA decide si se guarda, solo da forma
  //    a la respuesta. Corre en PARALELO con el cálculo de la respuesta para
  //    no sumar latencia; se espera antes de devolver (en serverless una
  //    promesa huérfana puede morir congelada a mitad de escritura).
  const captura = capturarTurno(supabase, user.id, body.pregunta).then(
    (result) => ({ ok: true as const, result }),
    () => ({ ok: false as const, result: null })
  );

  // (clasificarIntencion nunca lanza: ante fallo devuelve 'consulta')
  const intencion = await clasificarIntencion(body.pregunta);

  // 1) Pidió registrar explícitamente → la respuesta ES la confirmación,
  //    siempre visible. Si el guardado falló, se DICE — jamás fingir que se
  //    guardó ni dejar una nota perdida en silencio.
  if (intencion === 'registro') {
    const c = await captura;
    return NextResponse.json({
      answer: c.ok
        ? confirmacionRegistro(c.result)
        : 'He entendido que quieres que lo apunte, pero no he podido guardarlo ahora mismo. Vuelve a enviármelo en un momento, por favor.',
      kind: 'registro',
    });
  }

  // 2) ¿Es una pregunta de datos de negocio? (solo para quien tiene acceso)
  let payload: { answer: string; kind: string; grounded?: boolean } | null = null;
  if (datosAllowed) {
    try {
      const svc = createServiceClient();
      const answer = await responderPreguntaDatos(
        svc,
        body.pregunta,
        body.historial as TurnoChat[] | undefined
      );
      if (answer !== null) {
        payload = { answer, kind: 'datos' };
      }
    } catch {
      // si el motor de datos falla, no rompemos el chat: caemos a memoria
    }
  }

  // 3) Si no es de datos, responder desde su memoria personal (RAG con citas).
  if (!payload) {
    try {
      const res = await synthesizeAnswer(supabase, user.id, body.pregunta);
      payload = { answer: res.answer_md, kind: 'memoria', grounded: res.grounded };
    } catch (e) {
      await captura; // la captura del turno no se pierde aunque falle la respuesta
      return NextResponse.json(
        { error: 'assistant_failed', detail: String(e).slice(0, 300) },
        { status: 500 }
      );
    }
  }

  // La ingesta del turno termina antes de responder (fallo aquí no rompe la
  // respuesta: un turno-consulta no contiene información nueva que perder).
  await captura;
  return NextResponse.json(payload);
}
