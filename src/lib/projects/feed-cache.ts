// =====================================================
// Feed cache (Sprint 3)
// Persiste el resultado del LLM-generated feed para evitar
// regenerar en cada carga (cuesta dinero y latencia).
//
// TTL por defecto: 1 hora. Forzable con ?refresh=1.
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { generateFeed, type FeedResult } from './feed';

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hora

export interface FeedCacheResult {
  feed: FeedResult;
  from_cache: boolean;
  cached_age_minutes: number | null;
}

export async function getOrBuildFeed(
  supabase: SupabaseClient,
  userId: string,
  opts: { forceRefresh?: boolean; ttlMs?: number } = {}
): Promise<FeedCacheResult> {
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;

  if (!opts.forceRefresh) {
    const { data: cached } = await supabase
      .from('feed_cache')
      .select('payload, generated_at, expires_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (cached && new Date(cached.expires_at).getTime() > Date.now()) {
      const ageMin = Math.floor(
        (Date.now() - new Date(cached.generated_at).getTime()) / 60_000
      );
      return {
        feed: cached.payload as FeedResult,
        from_cache: true,
        cached_age_minutes: ageMin,
      };
    }
  }

  // Generar y persistir
  const feed = await generateFeed(supabase, userId);
  const expiresAt = new Date(Date.now() + ttl).toISOString();

  await supabase.from('feed_cache').upsert(
    {
      user_id: userId,
      payload: feed,
      generated_at: feed.generated_at,
      expires_at: expiresAt,
      model_used: feed.model_used,
      projects_considered: feed.projects_considered,
    },
    { onConflict: 'user_id' }
  );

  return {
    feed,
    from_cache: false,
    cached_age_minutes: 0,
  };
}

/**
 * Invalida el cache del feed (forzar regenerar en la próxima petición).
 * Llamar tras eventos que cambian significativamente el estado: completar
 * un paso, archivar un proyecto, captura masiva, etc.
 */
export async function invalidateFeedCache(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  await supabase.from('feed_cache').delete().eq('user_id', userId);
}
