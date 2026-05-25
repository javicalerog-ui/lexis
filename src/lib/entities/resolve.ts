// =====================================================
// Resolver de entidades
// Match por nombre exacto, alias o similarity.
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { embedOne } from '@/lib/embeddings/voyage';

const NAME_SIMILARITY_THRESHOLD = 0.6;

export type EntityType = 'person' | 'org' | 'place' | 'concept' | 'product';

export interface ResolvedEntity {
  id: string;
  name: string;
  entity_type: EntityType;
  created: boolean;
}

export async function resolveEntity(
  supabase: SupabaseClient,
  userId: string,
  name: string,
  entityType: EntityType
): Promise<ResolvedEntity | null> {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length < 2) return null;

  // 1. Match exacto por name o alias
  const { data: byName } = await supabase
    .from('entities')
    .select('id, name, entity_type')
    .eq('user_id', userId)
    .eq('entity_type', entityType)
    .ilike('name', trimmed)
    .limit(1)
    .maybeSingle();

  if (byName) {
    await touch(supabase, byName.id);
    return { ...byName, entity_type: byName.entity_type as EntityType, created: false };
  }

  const { data: byAlias } = await supabase
    .from('entities')
    .select('id, name, entity_type')
    .eq('user_id', userId)
    .eq('entity_type', entityType)
    .contains('aliases', [trimmed])
    .limit(1)
    .maybeSingle();

  if (byAlias) {
    await touch(supabase, byAlias.id);
    return { ...byAlias, entity_type: byAlias.entity_type as EntityType, created: false };
  }

  // 2. Similarity por trigram
  const { data: similar } = await supabase.rpc('entity_name_similarity', {
    p_user: userId,
    p_query: trimmed,
    p_type: entityType,
  });

  if (similar && similar.length > 0 && similar[0].sim >= NAME_SIMILARITY_THRESHOLD) {
    await touch(supabase, similar[0].id);
    return {
      id: similar[0].id,
      name: similar[0].name,
      entity_type: similar[0].entity_type,
      created: false,
    };
  }

  // 3. Crear nueva. Generar embedding del nombre.
  const embedding = await embedOne(trimmed, 'document').catch(() => null);

  const { data: inserted, error } = await supabase
    .from('entities')
    .insert({
      user_id: userId,
      name: trimmed,
      entity_type: entityType,
      aliases: [],
      attributes: {},
      embedding,
      last_seen_at: new Date().toISOString(),
    })
    .select('id, name, entity_type')
    .single();

  if (error || !inserted) {
    // Posible conflicto unique → reintenta lectura
    const { data: retry } = await supabase
      .from('entities')
      .select('id, name, entity_type')
      .eq('user_id', userId)
      .eq('name', trimmed)
      .eq('entity_type', entityType)
      .maybeSingle();
    if (retry) {
      return { ...retry, entity_type: retry.entity_type as EntityType, created: false };
    }
    throw new Error(`No se pudo crear la entidad "${trimmed}": ${error?.message}`);
  }

  return { ...inserted, entity_type: inserted.entity_type as EntityType, created: true };
}

async function touch(supabase: SupabaseClient, entityId: string) {
  await supabase
    .from('entities')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', entityId);
}
