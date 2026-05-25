'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import styles from './page.module.css';

type Priority = 'now' | 'this_week' | 'soon';
type Category = 'decision' | 'action' | 'communication' | 'review' | 'hygiene';

interface FeedItem {
  title: string;
  detail: string;
  priority: Priority;
  category: Category;
  related_project_slugs: string[];
  related_entity_names: string[];
}

interface FeedResult {
  summary: string;
  items: FeedItem[];
  stale_projects: string[];
  confidence: number;
  generated_at: string;
  model_used: string;
  projects_considered: number;
}

const PRIORITY_LABEL: Record<Priority, string> = {
  now: 'Ahora',
  this_week: 'Esta semana',
  soon: 'Pronto',
};

const PRIORITY_ORDER: Priority[] = ['now', 'this_week', 'soon'];

const CATEGORY_GLYPH: Record<Category, string> = {
  decision: '◆',
  action: '▶',
  communication: '✉',
  review: '⌖',
  hygiene: '◯',
};

const CATEGORY_LABEL: Record<Category, string> = {
  decision: 'Decisión',
  action: 'Acción',
  communication: 'Comunicación',
  review: 'Revisión',
  hygiene: 'Mantenimiento',
};

export default function FeedPage() {
  const [feed, setFeed] = useState<FeedResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/feed');
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error);
      setFeed(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const groupedItems: Record<Priority, FeedItem[]> = {
    now: [],
    this_week: [],
    soon: [],
  };
  for (const item of feed?.items ?? []) {
    if (groupedItems[item.priority]) {
      groupedItems[item.priority].push(item);
    }
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}>
          ← Chat
        </Link>
        <h1 className={styles.title}>
          <span className={styles.titleAccent}>feed</span>
        </h1>
        <button
          onClick={load}
          disabled={busy}
          className={styles.refresh}
          title="Regenerar"
        >
          ↻
        </button>
      </header>

      <div className={styles.content}>
        {busy && !feed && (
          <div className={styles.loading}>
            <div className={styles.loadingHalo} aria-hidden />
            <p className={styles.loadingText}>
              Sintetizando lo que merece tu atención…
            </p>
          </div>
        )}

        {error && (
          <div className={styles.error}>
            <strong>Error</strong> · {error}
          </div>
        )}

        {feed && (
          <>
            <section className={styles.intro}>
              <p className={styles.summary}>{feed.summary}</p>
              <p className={styles.metaLine}>
                <span>{feed.projects_considered} proyectos considerados</span>
                <span className={styles.metaDot} />
                <span>{feed.items.length} ítems</span>
                <span className={styles.metaDot} />
                <span className={styles.metaTime}>
                  generado{' '}
                  {relativeTime(feed.generated_at)}
                </span>
              </p>
            </section>

            <UpcomingEventsSection />

            {PRIORITY_ORDER.map((priority) => {
              const items = groupedItems[priority];
              if (!items.length) return null;
              return (
                <section
                  key={priority}
                  className={`${styles.section} ${styles[`pri_${priority}`]}`}
                >
                  <header className={styles.sectionHead}>
                    <span className={styles.priorityDot} />
                    <h2 className={styles.sectionTitle}>
                      {PRIORITY_LABEL[priority]}
                    </h2>
                    <span className={styles.sectionCount}>{items.length}</span>
                  </header>
                  <ol className={styles.items}>
                    {items.map((item, i) => (
                      <li
                        key={`${priority}-${i}`}
                        className={styles.item}
                        style={{ animationDelay: `${i * 60}ms` }}
                      >
                        <header className={styles.itemHead}>
                          <span
                            className={`${styles.glyph} ${styles[`cat_${item.category}`]}`}
                            title={CATEGORY_LABEL[item.category]}
                          >
                            {CATEGORY_GLYPH[item.category]}
                          </span>
                          <h3 className={styles.itemTitle}>{item.title}</h3>
                        </header>
                        <p className={styles.detail}>{item.detail}</p>
                        {(item.related_project_slugs.length > 0 ||
                          item.related_entity_names.length > 0) && (
                          <div className={styles.tags}>
                            {item.related_project_slugs.map((s) => (
                              <Link
                                key={s}
                                href={`/projects/${s}`}
                                className={styles.tagProject}
                              >
                                ✦ {s}
                              </Link>
                            ))}
                            {item.related_entity_names.map((n) => (
                              <span key={n} className={styles.tagEntity}>
                                {n}
                              </span>
                            ))}
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                </section>
              );
            })}

            {feed.stale_projects.length > 0 && (
              <section className={styles.stale}>
                <h2 className={styles.staleTitle}>
                  Proyectos sin actividad — ¿revisar?
                </h2>
                <div className={styles.staleList}>
                  {feed.stale_projects.map((s) => (
                    <Link key={s} href={`/projects/${s}`} className={styles.staleChip}>
                      {s}
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr}h`;
  const day = Math.floor(hr / 24);
  return `hace ${day}d`;
}

// =====================================================
// Sprint 15: sección "Próximos eventos" alimentada por la tabla events.
// =====================================================

interface UpcomingEvent {
  id: string;
  title: string;
  due_at: string;
  all_day: boolean;
  type: 'deadline' | 'meeting' | 'follow_up' | 'reminder' | 'recurring';
  source: 'calendar' | 'voice' | 'image' | 'text' | 'manual';
}

const EVENT_TYPE_GLYPH: Record<UpcomingEvent['type'], string> = {
  deadline: '◐',
  meeting: '◷',
  follow_up: '⌥',
  reminder: '○',
  recurring: '⟳',
};

function UpcomingEventsSection() {
  const [events, setEvents] = useState<UpcomingEvent[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const now = new Date();
    const in14d = new Date(now.getTime() + 14 * 86400_000);
    const qs = new URLSearchParams({
      status: 'pending',
      from: now.toISOString(),
      to: in14d.toISOString(),
      limit: '20',
    });
    fetch(`/api/events?${qs}`)
      .then((r) => r.json())
      .then((d) => setEvents(d.events ?? []))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded || events.length === 0) return null;

  return (
    <section className={styles.section} style={{ marginBottom: '1.5rem' }}>
      <header className={styles.sectionHead}>
        <span className={styles.priorityDot} style={{ background: 'var(--accent-secondary)' }} />
        <h2 className={styles.sectionTitle}>Próximos eventos</h2>
        <span className={styles.sectionCount}>{events.length}</span>
      </header>
      <ol className={styles.items}>
        {events.slice(0, 8).map((e) => (
          <li key={e.id} className={styles.item}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'baseline' }}>
              <span style={{ fontSize: '13px', color: 'var(--accent-secondary)' }}>
                {EVENT_TYPE_GLYPH[e.type]}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '14px',
                  color: 'var(--fg-0)',
                  marginBottom: '2px',
                }}>
                  {e.title}
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--fg-3)' }}>
                  {new Intl.DateTimeFormat('es-ES', {
                    weekday: 'short',
                    day: '2-digit',
                    month: 'short',
                    hour: e.all_day ? undefined : '2-digit',
                    minute: e.all_day ? undefined : '2-digit',
                    hourCycle: 'h23',
                  }).format(new Date(e.due_at))}
                  {' · '}
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{e.source}</span>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
