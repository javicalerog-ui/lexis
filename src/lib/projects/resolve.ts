// =====================================================
// Resolver de proyectos
// Dado un nombre extraído por el LLM (e.g. "Clavis"),
// encontrar el proyecto existente o crear uno nuevo.
//
// Estrategia:
//  1. Match exacto por slug/name (case-insensitive)
//  2. Similarity por pg_trgm sobre name
//  3. Si nada cuaja → crear nuevo
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { toSlug } from '@/lib/utils/slug';

const NAME_SIMILARITY_THRESHOLD = 0.55;

export interface ResolvedProject {
  id: string;
  slug: string;
  name: string;
  created: boolean;
}

export async function resolveProject(
  supabase: SupabaseClient,
  userId: string,
  name: string
): Promise<ResolvedProject | null> {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length < 2) return null;

  const candidateSlug = toSlug(trimmed);

  // 1. Match exacto por slug o nombre (case-insensitive)
  const { data: exact } = await supabase
    .from('projects')
    .select('id, slug, name')
    .eq('user_id', userId)
    .or(`slug.eq.${candidateSlug},name.ilike.${trimmed}`)
    .limit(1)
    .maybeSingle();

  if (exact) {
    await touch(supabase, exact.id);
    return { ...exact, created: false };
  }

  // 2. Similarity (pg_trgm). Necesita la extensión activa (ya está).
  const { data: similar } = await supabase.rpc(
    'project_name_similarity',
    { p_user: userId, p_query: trimmed }
  );

  if (similar && similar.length > 0 && similar[0].sim >= NAME_SIMILARITY_THRESHOLD) {
    await touch(supabase, similar[0].id);
    return {
      id: similar[0].id,
      slug: similar[0].slug,
      name: similar[0].name,
      created: false,
    };
  }

  // 3. Crear nuevo. Asegurar slug único.
  const finalSlug = await ensureUniqueSlug(supabase, userId, candidateSlug);

  const { data: inserted, error } = await supabase
    .from('projects')
    .insert({
      user_id: userId,
      name: trimmed,
      slug: finalSlug,
      status: 'active',
      last_activity_at: new Date().toISOString(),
    })
    .select('id, slug, name')
    .single();

  if (error || !inserted) {
    throw new Error(`No se pudo crear el proyecto "${trimmed}": ${error?.message}`);
  }

  return { ...inserted, created: true };
}

async function touch(supabase: SupabaseClient, projectId: string) {
  await supabase
    .from('projects')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('id', projectId);
}

async function ensureUniqueSlug(
  supabase: SupabaseClient,
  userId: string,
  base: string
): Promise<string> {
  const { data: existing } = await supabase
    .from('projects')
    .select('slug')
    .eq('user_id', userId)
    .like('slug', `${base}%`);

  const taken = new Set((existing ?? []).map((r) => r.slug));
  if (!taken.has(base)) return base;

  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
