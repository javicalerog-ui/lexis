// =====================================================
// GET    /api/credentials                — lista credentials del user (sin tokens)
// GET    /api/credentials?provider=google&scopes=...  — filtrar
// =====================================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const providerFilter = url.searchParams.get('provider');
  const requiredScopesParam = url.searchParams.get('scopes');     // separados por coma
  const requiredScopes = requiredScopesParam
    ? requiredScopesParam.split(',').map((s) => s.trim()).filter(Boolean)
    : null;

  let q = supabase
    .from('connector_credentials')
    .select(
      'id, provider, label, account_identifier, scopes, expires_at, created_at, updated_at'
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (providerFilter) q = q.eq('provider', providerFilter);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let items = data ?? [];

  // Filtrar por scopes requeridos (todas presentes)
  if (requiredScopes && requiredScopes.length > 0) {
    items = items.filter((c) =>
      requiredScopes.every((s) => (c.scopes ?? []).includes(s))
    );
  }

  return NextResponse.json({ credentials: items, count: items.length });
}
