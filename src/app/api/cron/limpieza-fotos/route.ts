// =====================================================
// GET /api/cron/limpieza-fotos
// Protegido por Authorization: Bearer <CRON_SECRET>.
//
// Aplica la retención de las fotos del asistente (ver retencionFotos.ts). Lo
// lanza Vercel una vez al día (vercel.json): el plan gratuito lo permite y
// Vercel ya envía CRON_SECRET en esa cabecera. Si un día no corre, no pasa
// nada: la pasada siguiente recoge lo pendiente.
//
// Cada pasada deja una fila en assistant_events (kind='limpieza-fotos', sin
// datos personales) para poder comprobar que sigue corriendo.
// =====================================================

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { isCronRequestAuthorized } from '@/lib/security/cron-auth.mjs';
import { limpiarFotos } from '@/lib/assistant/retencionFotos';
import { registrarEvento } from '@/lib/assistant/eventos';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!isCronRequestAuthorized(req.headers)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const t0 = Date.now();
  const svc = createServiceClient();
  const { data, error } = await svc.auth.admin.listUsers({ perPage: 200 });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  const usuarios = data.users;

  const r = await limpiarFotos(svc, usuarios.map((u) => u.id));

  const admin = usuarios.find((u) => u.app_metadata?.role === 'admin');
  if (admin) {
    await registrarEvento(svc, {
      userId: admin.id,
      kind: 'limpieza-fotos',
      code: r.errores ? 'internal' : 'ok',
      ms: Date.now() - t0,
      detail: `revisadas=${r.revisadas} caducadas=${r.caducadas} huerfanas=${r.huerfanas} errores=${r.errores}`,
    });
  }
  return NextResponse.json({ ok: r.errores === 0, ...r });
}
