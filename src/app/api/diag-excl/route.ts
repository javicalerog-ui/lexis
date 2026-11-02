// TEMPORAL (diagnóstico): comprueba si la función ve las EXCLUDED_TOPICS_*.
// No expone el CONTENIDO, solo longitudes y nombres de clave. Solo admin.
// Se borra en cuanto confirmemos el filtro.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/auth/admin';
import { comprobarExclusion } from '@/lib/ingestion/exclusions';

export const runtime = 'nodejs';

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const strong = process.env.EXCLUDED_TOPICS_STRONG;
  const weak = process.env.EXCLUDED_TOPICS_WEAK;
  return NextResponse.json({
    claves_excluded: Object.keys(process.env).filter((k) => k.toUpperCase().includes('EXCLUDED')),
    strong_def: strong !== undefined,
    strong_len: strong === undefined ? -1 : strong.length,
    strong_primeros2: strong ? strong.slice(0, 2) : null,
    weak_def: weak !== undefined,
    weak_len: weak === undefined ? -1 : weak.length,
    test_banco: comprobarExclusion('banco de valencia'),
  });
}
