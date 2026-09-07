// =====================================================
// Rol admin (Build 1 de la unificación Lexis)
//
// El rol vive en `app_metadata.role` del usuario de Supabase Auth. Se pone
// UNA vez con el service role (script/SQL); app_metadata NO lo puede editar
// el propio usuario (a diferencia de user_metadata o de una fila en
// user_settings), así que Silvestre no puede autoascenderse a admin.
//
// Uso en una ruta server-only:
//   const gate = await requireAdmin();
//   if (gate instanceof NextResponse) return gate;   // 401/403 ya formados
//   // ... gate.user es el admin autenticado
// =====================================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { User } from '@supabase/supabase-js';

export function isAdmin(user: User | null | undefined): boolean {
  return user?.app_metadata?.role === 'admin';
}

export interface AdminContext {
  user: User;
}

/**
 * Exige sesión + rol admin. Devuelve { user } si pasa, o una NextResponse
 * 401/403 ya lista para devolver si no. Para usar al principio de cualquier
 * ruta /api/admin/*.
 */
export async function requireAdmin(): Promise<AdminContext | NextResponse> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isAdmin(user)) {
    return NextResponse.json({ error: 'forbidden', detail: 'admin only' }, { status: 403 });
  }
  return { user };
}
