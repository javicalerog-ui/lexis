import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { EntitySummaryCard } from '@/components/entities/EntitySummaryCard';
import styles from './page.module.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

const TYPE_LABEL: Record<string, string> = {
  person: 'persona',
  org: 'organización',
  place: 'lugar',
  concept: 'concepto',
  product: 'producto',
};

export default async function EntityDetailPage({ params }: PageProps) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: entity } = await supabase
    .from('entities')
    .select(
      'id, name, entity_type, aliases, attributes, rolling_summary, rolling_summary_updated_at, summary_payload, summary_stale, interaction_count, last_seen_at, created_at, key_facts'
    )
    .eq('user_id', user.id)
    .eq('id', params.id)
    .maybeSingle();

  if (!entity) notFound();

  const { data: memLinks } = await supabase
    .from('memory_entities')
    .select('role, memories(id, content, summary, source_type, captured_at, status)')
    .eq('entity_id', entity.id);

  const memories = (memLinks ?? [])
    .map((l: any) => l.memories)
    .filter((m: any) => m && m.status === 'active')
    .sort((a: any, b: any) => (a.captured_at < b.captured_at ? 1 : -1));

  // Proyectos donde aparece
  let projects: Array<{
    id: string;
    slug: string;
    name: string;
    status: string;
    count: number;
  }> = [];
  if (memories.length) {
    const memIds = memories.map((m: any) => m.id);
    const { data: pLinks } = await supabase
      .from('memory_projects')
      .select('project_id, projects(id, slug, name, status)')
      .in('memory_id', memIds);
    const map = new Map<string, { id: string; slug: string; name: string; status: string; count: number }>();
    for (const l of pLinks ?? []) {
      const p: any = (l as any).projects;
      if (!p) continue;
      const prev = map.get(p.id);
      if (prev) prev.count++;
      else map.set(p.id, { id: p.id, slug: p.slug, name: p.name, status: p.status, count: 1 });
    }
    projects = Array.from(map.values()).sort((a, b) => b.count - a.count);
  }

  // Co-ocurrencias
  const { data: cooccurrences } = await supabase.rpc('entity_cooccurrence', {
    p_entity_id: entity.id,
    p_limit: 8,
  });

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Link href="/entities" className={styles.back}>
          ← Entidades
        </Link>
        <span className={`${styles.typePill} ${styles[`pill_${entity.entity_type}`]}`}>
          {TYPE_LABEL[entity.entity_type] || entity.entity_type}
        </span>
      </header>

      <div className={styles.content}>
        <section className={styles.hero}>
          <h1 className={styles.title}>{entity.name}</h1>
          {entity.aliases?.length > 0 && (
            <p className={styles.aliases}>
              También: <span>{entity.aliases.join(', ')}</span>
            </p>
          )}
          <div className={styles.heroMeta}>
            <span>
              <strong>{entity.interaction_count}</strong> interaccion
              {entity.interaction_count === 1 ? '' : 'es'}
            </span>
            {entity.last_seen_at && (
              <>
                <span className={styles.dot} />
                <span>visto {relativeDate(entity.last_seen_at)}</span>
              </>
            )}
          </div>
        </section>

        <EntitySummaryCard
          entityId={entity.id}
          initialPayload={entity.summary_payload as any}
          initialSummary={entity.rolling_summary}
          initialUpdatedAt={entity.rolling_summary_updated_at}
          summaryStale={entity.summary_stale}
          interactionCount={entity.interaction_count}
        />

        {projects.length > 0 && (
          <section className={styles.block}>
            <h2 className={styles.blockTitle}>
              <span className={styles.blockDotAccent} />
              Aparece en {projects.length} proyecto{projects.length === 1 ? '' : 's'}
            </h2>
            <div className={styles.projChips}>
              {projects.map((p) => (
                <Link key={p.id} href={`/projects/${p.slug}`} className={styles.projChip}>
                  <span className={styles.projName}>{p.name}</span>
                  <span className={`${styles.projStatus} ${styles[`ps_${p.status}`]}`}>
                    {p.status}
                  </span>
                  <span className={styles.projCount}>×{p.count}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {cooccurrences && cooccurrences.length > 0 && (
          <section className={styles.block}>
            <h2 className={styles.blockTitle}>
              <span className={styles.blockDotViolet} />
              Aparece junto a
            </h2>
            <div className={styles.cooccList}>
              {cooccurrences.map((c: any) => (
                <Link key={c.id} href={`/entities/${c.id}`} className={styles.cooccChip}>
                  <span className={`${styles.cooccDot} ${styles[`type_${c.entity_type}`]}`} />
                  <span>{c.name}</span>
                  <span className={styles.cooccCount}>×{c.cooccurrences}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className={styles.block}>
          <h2 className={styles.blockTitle}>
            <span className={styles.blockDotMuted} />
            {memories.length} memoria{memories.length === 1 ? '' : 's'}
          </h2>
          <ol className={styles.memoryList}>
            {memories.map((m: any) => (
              <li key={m.id} className={styles.memoryItem}>
                <div className={styles.memoryMeta}>
                  <span className={styles.memorySource}>{m.source_type}</span>
                  <span className={styles.memoryDate}>
                    {new Date(m.captured_at).toLocaleDateString('es-ES', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                </div>
                <p className={styles.memoryText}>{m.summary || m.content}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}

function relativeDate(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const day = Math.floor(ms / 86_400_000);
  if (day < 1) return 'hoy';
  if (day === 1) return 'ayer';
  if (day < 7) return `hace ${day}d`;
  if (day < 30) return `hace ${Math.floor(day / 7)}sem`;
  return `hace ${Math.floor(day / 30)}m`;
}
