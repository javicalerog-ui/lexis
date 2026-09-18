// =====================================================
// POST /api/datos/ask — pregunta de negocio sobre el motor de datos
//
// Body: { pregunta: string, historial?: [{role, content}] }
// Devuelve: { answer: string } o { answer: null } si la pregunta no es de datos
// (para que el chat siga su curso normal).
//
// Acceso restringido: solo admin (Javi) o usuarios con app_metadata.datos_access
// = true (Silvestre). Los datos llevan nombres reales de clientes/proveedores.
//
// La consulta se ejecuta con el cliente service_role porque la función
// datos.run_query solo la puede invocar service_role — pero al ser SECURITY
// DEFINER corre como el rol datos_ro (sin acceso a public/auth): el aislamiento
// se mantiene. El SQL lo genera y valida la capa qa/validar-sql.
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { User } from '@supabase/supabase-js';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/auth/admin';
import { responderPreguntaDatos, type TurnoChat } from '@/lib/datos/qa';

export const runtime = 'nodejs';
export const maxDuration = 60;

const Schema = z.object({
  pregunta: z.string().min(1).max(2000),
  historial: z
    .array(z.object({ role: z.string(), content: z.string() }))
    .max(20)
    .optional(),
});

function tieneAccesoDatos(user: User): boolean {
  return isAdmin(user) || user.app_metadata?.datos_access === true;
}

export async function POST(req: Request) {
  const supabaseAuth = createClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!tieneAccesoDatos(user)) {
    return NextResponse.json({ error: 'forbidden', detail: 'sin acceso a datos' }, { status: 403 });
  }

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: 'invalid_body', detail: String(e) }, { status: 400 });
  }

  const supabase = createServiceClient();
  try {
    const answer = await responderPreguntaDatos(
      supabase,
      body.pregunta,
      body.historial as TurnoChat[] | undefined,
      user.id
    );
    return NextResponse.json({ answer });
  } catch (e) {
    return NextResponse.json(
      { error: 'datos_failed', detail: String(e).slice(0, 300) },
      { status: 500 }
    );
  }
}
