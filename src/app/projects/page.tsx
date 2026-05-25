import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { ProjectCard } from '@/components/projects/ProjectCard';
import styles from './page.module.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  rolling_summary: string | null;
  last_activity_at: string | null;
  memory_count: number;
}

export default async function ProjectsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // Reutilizamos la lógica de /api/projects haciendo SELECT directo
  const { data: projects } = await supabase
    .from('projects')
    .select(
      'id, name, slug, description, status, rolling_summary, last_activity_at'
    )
    .eq('user_id', user.id)
    .order('last_activity_at', { ascending: false, nullsFirst: false });

  const ids = (projects ?? []).map((p) => p.id);
  const counts: Record<string, number> = {};
  if (ids.length) {
    const { data: cs } = await supabase
      .from('memory_projects')
      .select('project_id, memories(status)')
      .in('project_id', ids);
    for (const c of cs ?? []) {
      const status = (c as any).memories?.status;
      if (status === 'active') {
        counts[c.project_id] = (counts[c.project_id] ?? 0) + 1;
      }
    }
  }

  const rows: ProjectRow[] = (projects ?? []).map((p) => ({
    ...p,
    memory_count: counts[p.id] ?? 0,
  }));

  const active = rows.filter((p) => p.status === 'active');
  const paused = rows.filter((p) => p.status === 'paused');
  const archived = rows.filter(
    (p) => p.status === 'archived' || p.status === 'done'
  );

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}>
          ← Chat
        </Link>
        <h1 className={styles.title}>
          <span className={styles.titleAccent}>proyectos</span>
        </h1>
        <div className={styles.spacer} />
      </header>

      <div className={styles.content}>
        {!rows.length && (
          <div className={styles.empty}>
            <p>
              Aún no hay proyectos. Cuando captures algo que mencione un proyecto, Lexis lo
              creará automáticamente.
            </p>
          </div>
        )}

        {active.length > 0 && (
          <Section title="Activos" count={active.length}>
            {active.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </Section>
        )}

        {paused.length > 0 && (
          <Section title="Pausados" count={paused.length}>
            {paused.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </Section>
        )}

        {archived.length > 0 && (
          <Section title="Cerrados" count={archived.length}>
            {archived.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </Section>
        )}
      </div>
    </main>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        <span className={styles.sectionCount}>{count}</span>
      </header>
      <div className={styles.grid}>{children}</div>
    </section>
  );
}
