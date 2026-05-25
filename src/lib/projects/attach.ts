// =====================================================
// Attach memory ↔ projects
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveProject } from './resolve';

export interface AttachedProject {
  project_id: string;
  slug: string;
  name: string;
  created: boolean;
}

/**
 * Para cada nombre de proyecto extraído por el LLM, resuelve (o crea) y
 * enlaza con la memoria.
 */
export async function attachMemoryToProjects(
  supabase: SupabaseClient,
  userId: string,
  memoryId: string,
  projectNames: string[]
): Promise<AttachedProject[]> {
  const unique = Array.from(new Set(projectNames.map((n) => n.trim()).filter(Boolean)));
  const attached: AttachedProject[] = [];

  for (const name of unique) {
    try {
      const resolved = await resolveProject(supabase, userId, name);
      if (!resolved) continue;

      const { error } = await supabase
        .from('memory_projects')
        .upsert(
          {
            memory_id: memoryId,
            project_id: resolved.id,
            relevance: 1.0,
            assigned_by: 'classifier',
          },
          { onConflict: 'memory_id,project_id' }
        );

      if (error) {
        console.error('attach project failed', name, error);
        continue;
      }

      attached.push({
        project_id: resolved.id,
        slug: resolved.slug,
        name: resolved.name,
        created: resolved.created,
      });
    } catch (e) {
      console.error('resolveProject failed', name, e);
    }
  }

  return attached;
}
