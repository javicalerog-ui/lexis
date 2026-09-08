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

  // 1) ¿Es una pregunta de datos de negocio? (solo para quien tiene acceso)
  if (datosAllowed) {
    try {
      const svc = createServiceClient();
      const answer = await responderPreguntaDatos(
        svc,
        body.pregunta,
        body.historial as TurnoChat[] | undefined
      );
      if (answer !== null) {
        return NextResponse.json({ answer, kind: 'datos' });
      }
    } catch {
      // si el motor de datos falla, no rompemos el chat: caemos a memoria
    }
  }

  // 2) Si no es de datos, responder desde su memoria personal (RAG con citas).
  try {
    const res = await synthesizeAnswer(supabase, user.id, body.pregunta);
    return NextResponse.json({ answer: res.answer_md, kind: 'memoria', grounded: res.grounded });
  } catch (e) {
    return NextResponse.json(
      { error: 'assistant_failed', detail: String(e).slice(0, 300) },
      { status: 500 }
    );
  }
}
