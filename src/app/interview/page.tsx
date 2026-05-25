import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { SessionStarter } from '@/components/interview/SessionStarter';
import styles from './page.module.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function InterviewListPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: sessions } = await supabase
    .from('interview_sessions')
    .select(
      'id, status, focus_type, focus_project_id, focus_entity_id, title, summary, questions_asked, memories_generated, created_at, last_message_at, completed_at'
    )
    .eq('user_id', user.id)
    .order('last_message_at', { ascending: false });

  // Cargar nombres de los focos
  const projectIds = new Set<string>();
  const entityIds = new Set<string>();
  for (const s of sessions ?? []) {
    if (s.focus_project_id) projectIds.add(s.focus_project_id);
    if (s.focus_entity_id) entityIds.add(s.focus_entity_id);
  }

  const focusNames = new Map<string, string>();
  if (projectIds.size) {
    const { data: ps } = await supabase
      .from('projects')
      .select('id, name')
      .in('id', Array.from(projectIds));
    for (const p of ps ?? []) focusNames.set(p.id, p.name);
  }
  if (entityIds.size) {
    const { data: es } = await supabase
      .from('entities')
      .select('id, name')
      .in('id', Array.from(entityIds));
    for (const e of es ?? []) focusNames.set(e.id, e.name);
  }

  // Cargar proyectos y entidades para el starter (limitado)
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, slug')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('last_activity_at', { ascending: false, nullsFirst: false })
    .limit(20);

  const { data: entities } = await supabase
    .from('entities')
    .select('id, name, entity_type')
    .eq('user_id', user.id)
    .order('last_seen_at', { ascending: false, nullsFirst: false })
    .limit(30);

  const active = (sessions ?? []).filter((s) => s.status === 'active');
  const completed = (sessions ?? []).filter((s) => s.status === 'completed');

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}>
          ← Chat
        </Link>
        <h1 className={styles.title}>
          <span className={styles.titleAccent}>entrevista</span>
        </h1>
        <div />
      </header>

      <div className={styles.content}>
        <SessionStarter
          projects={projects ?? []}
          entities={entities ?? []}
        />

        {active.length > 0 && (
          <section className={styles.section}>
            <header className={styles.sectionHead}>
              <span className={styles.dotAccent} />
              <h2 className={styles.sectionTitle}>Sesiones en curso</h2>
              <span className={styles.sectionCount}>{active.length}</span>
            </header>
            <div className={styles.list}>
              {active.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  focusName={
                    s.focus_project_id
                      ? focusNames.get(s.focus_project_id)
                      : s.focus_entity_id
                      ? focusNames.get(s.focus_entity_id)
                      : undefined
                  }
                />
              ))}
            </div>
          </section>
        )}

        {completed.length > 0 && (
          <section className={styles.section}>
            <header className={styles.sectionHead}>
              <span className={styles.dotMuted} />
              <h2 className={styles.sectionTitle}>Sesiones cerradas</h2>
              <span className={styles.sectionCount}>{completed.length}</span>
            </header>
            <div className={styles.list}>
              {completed.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  focusName={
                    s.focus_project_id
                      ? focusNames.get(s.focus_project_id)
                      : s.focus_entity_id
                      ? focusNames.get(s.focus_entity_id)
                      : undefined
                  }
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function SessionRow({
  session,
  focusName,
}: {
  session: any;
  focusName?: string;
}) {
  const date = new Date(
    session.last_message_at || session.created_at
  ).toLocaleString('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  const focusLabel =
    session.focus_type === 'project'
      ? `Proyecto · ${focusName || '?'}`
      : session.focus_type === 'entity'
      ? `Entidad · ${focusName || '?'}`
      : 'Exploratoria';

  return (
    <Link
      href={`/interview/${session.id}`}
      className={`${styles.row} ${
        session.status === 'active' ? styles.rowActive : ''
      }`}
    >
      <div className={styles.rowHead}>
        <span className={styles.rowFocus}>{focusLabel}</span>
        <span className={styles.rowDate}>{date}</span>
      </div>
      <p className={styles.rowTitle}>
        {session.title ||
          (session.status === 'active'
            ? 'En curso — abre para continuar'
            : 'Sesión sin título')}
      </p>
      {session.summary?.overview && (
        <p className={styles.rowPreview}>{session.summary.overview}</p>
      )}
      <div className={styles.rowStats}>
        <span>
          <strong>{session.questions_asked}</strong> preguntas
        </span>
        <span className={styles.metricDot} />
        <span>
          <strong>{session.memories_generated}</strong> memorias
        </span>
        {session.summary?.new_projects?.length > 0 && (
          <>
            <span className={styles.metricDot} />
            <span>
              <strong>{session.summary.new_projects.length}</strong> proyecto
              {session.summary.new_projects.length === 1 ? '' : 's'} nuevo
              {session.summary.new_projects.length === 1 ? '' : 's'}
            </span>
          </>
        )}
      </div>
    </Link>
  );
}
