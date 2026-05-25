// =====================================================
// Attach memory ↔ entities
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveEntity, type EntityType } from './resolve';

export interface AttachedEntity {
  entity_id: string;
  name: string;
  entity_type: EntityType;
  created: boolean;
}

const VALID_TYPES: ReadonlyArray<EntityType> = [
  'person',
  'org',
  'place',
  'concept',
  'product',
];

export async function attachMemoryToEntities(
  supabase: SupabaseClient,
  userId: string,
  memoryId: string,
  entities: Array<{ name: string; type: string }>
): Promise<AttachedEntity[]> {
  const attached: AttachedEntity[] = [];

  for (const e of entities) {
    const t = e.type as EntityType;
    if (!VALID_TYPES.includes(t)) continue;
    if (!e.name?.trim()) continue;

    try {
      const resolved = await resolveEntity(supabase, userId, e.name, t);
      if (!resolved) continue;

      const { error } = await supabase
        .from('memory_entities')
        .upsert(
          {
            memory_id: memoryId,
            entity_id: resolved.id,
            role: 'mentioned',
          },
          { onConflict: 'memory_id,entity_id' }
        );

      if (error) {
        console.error('attach entity failed', e.name, error);
        continue;
      }

      attached.push({
        entity_id: resolved.id,
        name: resolved.name,
        entity_type: resolved.entity_type,
        created: resolved.created,
      });
    } catch (err) {
      console.error('resolveEntity failed', e.name, err);
    }
  }

  return attached;
}
