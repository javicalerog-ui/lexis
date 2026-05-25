import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import styles from './page.module.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

const CADENCE_LABEL: Record<string, string> = {
  weekly: 'Semana',
  biweekly: 'Quincena',
  monthly: 'Mes',
};

export default async function DigestDetailPage({ params }: PageProps) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: digest } = await supabase
    .from('digests')
    .select('*')
    .eq('user_id', user.id)
    .eq('id', params.id)
    .maybeSingle();

  if (!digest) notFound();

  const payload = digest.payload as any;
  const metrics = digest.metrics as any;

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
    });

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Link href="/digest" className={styles.back}>
          ← Histórico
        </Link>
        <span className={styles.period}>
          {CADENCE_LABEL[digest.cadence] || digest.cadence}{' '}
          {fmtDate(digest.period_start)} → {fmtDate(digest.period_end)}
        </span>
        <span className={`${styles.statusPill} ${styles[`pill_${digest.status}`]}`}>
          {digest.status}
        </span>
      </header>

      <div className={styles.content}>
        {/* Hero */}
        <section className={styles.hero}>
          <p className={styles.eyebrow}>Síntesis del periodo</p>
          <h1 className={styles.headline}>{payload?.headline}</h1>
          <p className={styles.overview}>{payload?.overview}</p>
        </section>

        {/* Métricas */}
        <section className={styles.metricsGrid}>
          <Metric label="Memorias" value={metrics?.new_memories ?? 0} accent />
          <Metric label="Proyectos tocados" value={metrics?.projects_touched ?? 0} />
          <Metric label="Decisiones" value={metrics?.decisions_count ?? 0} />
          <Metric label="Entidades nuevas" value={metrics?.new_entities ?? 0} />
        </section>

        {/* What moved */}
        {payload?.what_moved?.length > 0 && (
          <Section title="Lo que se movió" dot="accent">
            {payload.what_moved.map((m: any, i: number) => (
              <div key={i} className={styles.entry}>
                <h3 className={styles.entryTitle}>
                  {m.title}
                  {m.project_slug && (
                    <Link
                      href={`/projects/${m.project_slug}`}
                      className={styles.projLink}
                    >
                      ver proyecto →
                    </Link>
                  )}
                </h3>
                <p className={styles.entryDetail}>{m.detail}</p>
              </div>
            ))}
          </Section>
        )}

        {/* Decisions */}
        {payload?.decisions?.length > 0 && (
          <Section title="Decisiones tomadas" dot="success">
            {payload.decisions.map((d: any, i: number) => (
              <div key={i} className={styles.entry}>
                <h3 className={styles.entryTitle}>{d.title}</h3>
                <p className={styles.entryDetail}>{d.detail}</p>
              </div>
            ))}
          </Section>
        )}

        {/* Stalled */}
        {payload?.stalled?.length > 0 && (
          <Section title="Hilos parados" dot="warning">
            {payload.stalled.map((s: any, i: number) => (
              <div key={i} className={styles.entry}>
                <h3 className={styles.entryTitle}>
                  {s.title}
                  <span className={styles.daysIdle}>· {s.days_idle}d parado</span>
                </h3>
                <p className={`${styles.entryDetail} ${styles.italic}`}>
                  {s.suggestion}
                </p>
              </div>
            ))}
          </Section>
        )}

        {/* People */}
        {payload?.people?.length > 0 && (
          <Section title="Personas centrales" dot="violet">
            {payload.people.map((p: any, i: number) => (
              <div key={i} className={styles.entry}>
                <h3 className={styles.entryTitle}>{p.name}</h3>
                <p className={styles.entryDetail}>{p.context}</p>
              </div>
            ))}
          </Section>
        )}

        {/* Open question */}
        {payload?.open_question && (
          <section className={styles.question}>
            <p className={styles.questionEyebrow}>Una pregunta</p>
            <p className={styles.questionText}>{payload.open_question}</p>
          </section>
        )}

        {/* Tone note */}
        {payload?.tone_note && (
          <p className={styles.toneNote}>{payload.tone_note}</p>
        )}

        {/* Meta */}
        <footer className={styles.meta}>
          <span>generado {new Date(digest.generated_at).toLocaleString('es-ES')}</span>
          {digest.sent_at && (
            <>
              <span className={styles.metaDot} />
              <span>enviado a {digest.sent_to}</span>
            </>
          )}
          <span className={styles.metaDot} />
          <span className={styles.metaMono}>{digest.model_used}</span>
        </footer>
      </div>
    </main>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className={`${styles.metric} ${accent ? styles.metricAccent : ''}`}>
      <span className={styles.metricN}>{value}</span>
      <span className={styles.metricL}>{label}</span>
    </div>
  );
}

function Section({
  title,
  dot,
  children,
}: {
  title: string;
  dot: 'accent' | 'success' | 'warning' | 'violet';
  children: React.ReactNode;
}) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHead}>
        <span className={`${styles.sectionDot} ${styles[`d_${dot}`]}`} />
        <h2 className={styles.sectionTitle}>{title}</h2>
      </header>
      <div className={styles.entries}>{children}</div>
    </section>
  );
}
