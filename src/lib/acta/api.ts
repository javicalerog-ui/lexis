'use client';

// Capa de acceso del módulo Acta (grabador de reuniones) embebido en Lexis.
// La sesión es la de Lexis (cookies @supabase/ssr); el backend sigue siendo
// el Worker de Cloudflare de Acta, que valida el mismo JWT contra el mismo
// proyecto Supabase desde la consolidación (PLAN-CONSOLIDACION-LEXIS.md).

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

let _sb: SupabaseClient | null = null;

/** Cliente browser de Lexis, perezoso (no se crea durante el prerender). */
export function getSupabase(): SupabaseClient {
  if (!_sb) _sb = createClient();
  return _sb;
}

export const API_BASE: string =
  process.env.NEXT_PUBLIC_ACTA_API_BASE ?? 'https://acta.gpjcalero.workers.dev';

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}
