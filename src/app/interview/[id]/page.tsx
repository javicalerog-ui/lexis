import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { InterviewChat } from '@/components/interview/InterviewChat';
import styles from './page.module.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

export default async function InterviewSessionPage({ params }: PageProps) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: session } = await supabase
    .from('interview_sessions')
    .select(
      'id, status, focus_type, focus_project_id, focus_entity_id, title, summary, questions_asked, memories_generated, created_at, last_message_at, completed_at'
    )
    .eq('id', params.id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!session) notFound();

  let focusName: string | null = null;
  let focusSlug: string | null = null;
  if (session.focus_type === 'project' && session.focus_project_id) {
    const { data } = await supabase
      .from('projects')
      .select('name, slug')
      .eq('id', session.focus_project_id)
      .maybeSingle();
    focusName = data?.name ?? null;
    focusSlug = data?.slug ?? null;
  } else if (session.focus_type === 'entity' && session.focus_entity_id) {
    const { data } = await supabase
      .from('entities')
      .select('name')
      .eq('id', session.focus_entity_id)
      .maybeSingle();
    focusName = data?.name ?? null;
  }

  const { data: messages } = await supabase
    .from('interview_messages')
    .select('id, role, content, memory_id, topic_shift, created_at')
    .eq('session_id', session.id)
    .order('created_at', { ascending: true });

  const focusLabel =
    session.focus_type === 'project'
      ? `Proyecto · ${focusName || '?'}`
      : session.focus_type === 'entity'
      ? `Entidad · ${focusName || '?'}`
      : 'Exploratoria';

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Link href="/interview" className={styles.back}>
          ← Sesiones
        </Link>
        <div className={styles.headerInfo}>
          <span className={styles.focusLabel}>{focusLabel}</span>
          {focusSlug && (
            <Link href={`/projects/${focusSlug}`} className={styles.focusLink}>
              ver proyecto →
            </Link>
          )}
        </div>
        <span className={`${styles.statusPill} ${styles[`pill_${session.status}`]}`}>
          {session.status === 'active' ? 'en curso' : 'cerrada'}
        </span>
      </header>

      <InterviewChat
        sessionId={session.id}
        initialStatus={session.status}
        initialMessages={(messages ?? []).map((m) => ({
          id: m.id,
          role: m.role as 'assistant' | 'user',
          content: m.content,
          memory_id: m.memory_id,
          topic_shift: m.topic_shift,
        }))}
      />

      {session.status === 'completed' && session.summary && (
        <section className={styles.summaryBlock}>
          <header className={styles.summaryHead}>
            <span className={styles.summaryDot} aria-hidden />
            <h2 className={styles.summaryTitle}>Resumen de la sesión</h2>
            {session.title && (
              <span className={styles.summarySubtitle}>{session.title}</span>
            )}
          </header>

          {session.summary.overview && (
            <p className={styles.summaryOverview}>{session.summary.overview}</p>
          )}

          {session.summary.highlights?.length > 0 && (
            <div className={styles.summarySection}>
              <h3 className={styles.summarySectionTitle}>Lo más sustantivo</h3>
              <ul className={styles.summaryList}>
                {session.summary.highlights.map((h: string, i: number) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            </div>
          )}

          {session.summary.connections?.length > 0 && (
            <div className={styles.summarySection}>
              <h3 className={styles.summarySectionTitle}>Conexiones observadas</h3>
              <ul className={styles.summaryList}>
                {session.summary.connections.map((c: string, i: number) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          {(session.summary.new_projects?.length > 0 ||
            session.summary.new_entities?.length > 0) && (
            <div className={styles.summarySection}>
              <h3 className={styles.summarySectionTitle}>Nuevo en el grafo</h3>
              <div className={styles.summaryChips}>
                {session.summary.new_projects?.map((p: any) => (
                  <Link
                    key={p.slug}
                    href={`/projects/${p.slug}`}
                    className={styles.chipProject}
                  >
                    ✦ {p.name}
                  </Link>
                ))}
                {session.summary.new_entities?.map((e: any) => (
                  <Link
                    key={e.id}
                    href={`/entities/${e.id}`}
                    className={`${styles.chipEntity} ${styles[`chip_${e.type}`] || ''}`}
                  >
                    {e.name}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
