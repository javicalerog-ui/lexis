import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { refreshProjectSummary } from '@/lib/projects/refresh-summary';
import { NextStepsPanel } from '@/components/projects/NextStepsPanel';
import styles from './page.module.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { slug: string };
}

export default async function ProjectDetailPage({ params }: PageProps) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('user_id', user.id)
    .eq('slug', params.slug)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  // Oportunista: refrescar si está stale
  await refreshProjectSummary(supabase, project.id);

  // Recargar tras posible refresh
  const { data: fresh } = await supabase
    .from('projects')
    .select('*')
    .eq('id', project.id)
    .single();

  // Memorias activas asociadas
  const { data: memLinks } = await supabase
    .from('memory_projects')
    .select('memories(id, content, summary, source_type, captured_at, status)')
    .eq('project_id', project.id);

  const memories = (memLinks ?? [])
    .map((l: any) => l.memories)
    .filter((m: any) => m && m.status === 'active')
    .sort((a: any, b: any) => (a.captured_at < b.captured_at ? 1 : -1));

  // Entidades co-ocurrentes
  let coEntities: Array<{ id: string; name: string; entity_type: string; count: number }> = [];
  if (memories.length) {
    const memIds = memories.map((m: any) => m.id);
    const { data: entLinks } = await supabase
      .from('memory_entities')
      .select('entity_id, entities(id, name, entity_type)')
      .in('memory_id', memIds);
    const map = new Map<string, { id: string; name: string; entity_type: string; count: number }>();
    for (const l of entLinks ?? []) {
      const e: any = (l as any).entities;
      if (!e) continue;
      const prev = map.get(e.id);
      if (prev) prev.count++;
      else map.set(e.id, { id: e.id, name: e.name, entity_type: e.entity_type, count: 1 });
    }
    coEntities = Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 12);
  }

  const p = fresh ?? project;
  const nextSteps = parseNextSteps(p.rolling_next_steps);

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Link href="/projects" className={styles.back}>
          ← Proyectos
        </Link>
        <span className={`${styles.statusPill} ${styles[p.status] || ''}`}>
          {p.status}
        </span>
      </header>

      <div className={styles.content}>
        <h1 className={styles.title}>{p.name}</h1>
        {p.description && (
          <p className={styles.description}>{p.description}</p>
        )}

        <NextStepsPanel slug={p.slug} />

        <section className={styles.block}>
          <h2 className={styles.blockTitle}>
            <span className={styles.dotViolet} />
            Estado actual
          </h2>
          {p.rolling_summary ? (
            <p className={styles.summary}>{p.rolling_summary}</p>
          ) : (
            <p className={styles.emptyText}>
              Aún no hay resumen. Captura algunas memorias y se generará automáticamente.
            </p>
          )}
        </section>

        {nextSteps.length > 0 && (
          <section className={styles.block}>
            <h2 className={styles.blockTitle}>
              <span className={styles.dotAccent} />
              Próximos pasos
            </h2>
            <ul className={styles.steps}>
              {nextSteps.map((s, i) => (
                <li key={i} className={styles.step}>
                  <span className={styles.stepN}>{(i + 1).toString().padStart(2, '0')}</span>
                  <span className={styles.stepText}>{s}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {coEntities.length > 0 && (
          <section className={styles.block}>
            <h2 className={styles.blockTitle}>
              <span className={styles.dotMuted} />
              Personas y entidades
            </h2>
            <div className={styles.chips}>
              {coEntities.map((e) => (
                <Link
                  key={e.id}
                  href={`/entities/${e.id}`}
                  className={`${styles.chip} ${styles[`chip_${e.entity_type}`] || ''}`}
                >
                  <span className={styles.chipName}>{e.name}</span>
                  <span className={styles.chipCount}>{e.count}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className={styles.block}>
          <h2 className={styles.blockTitle}>
            <span className={styles.dotMuted} />
            Memorias ({memories.length})
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

function parseNextSteps(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split('\n')
    .map((l) => l.replace(/^[\s\-*\d.]+\s*/, '').trim())
    .filter(Boolean);
}
