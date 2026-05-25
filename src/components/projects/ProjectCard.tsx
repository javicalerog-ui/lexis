import Link from 'next/link';
import styles from './ProjectCard.module.css';

interface Props {
  project: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    status: string;
    rolling_summary: string | null;
    last_activity_at: string | null;
    memory_count: number;
  };
}

export function ProjectCard({ project }: Props) {
  const lastActivity = project.last_activity_at
    ? relativeDate(project.last_activity_at)
    : 'sin actividad';

  return (
    <Link href={`/projects/${project.slug}`} className={styles.card}>
      <div className={styles.head}>
        <h3 className={styles.name}>{project.name}</h3>
        <span className={`${styles.status} ${styles[project.status] || ''}`}>
          {project.status}
        </span>
      </div>

      {project.rolling_summary ? (
        <p className={styles.summary}>{project.rolling_summary}</p>
      ) : (
        <p className={styles.summaryEmpty}>Sin estado agregado aún.</p>
      )}

      <footer className={styles.foot}>
        <span className={styles.metric}>
          <span className={styles.metricN}>{project.memory_count}</span>
          <span className={styles.metricLabel}>memoria{project.memory_count === 1 ? '' : 's'}</span>
        </span>
        <span className={styles.dot} />
        <span className={styles.date}>{lastActivity}</span>
        <span className={styles.arrow} aria-hidden>→</span>
      </footer>
    </Link>
  );
}

function relativeDate(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  if (hr < 24) return `hace ${hr}h`;
  if (day < 7) return `hace ${day}d`;
  if (day < 30) return `hace ${Math.floor(day / 7)}sem`;
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
  });
}
