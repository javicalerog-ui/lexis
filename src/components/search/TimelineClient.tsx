'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import type { Filters, EnrichedMemory } from '@/lib/search/filters';
import { SearchFilters } from '@/components/search/SearchFilters';
import { fetchJson } from '@/lib/fetch-json';
import styles from './TimelineClient.module.css';

interface Props {
  projects: Array<{ id: string; name: string; slug: string }>;
  entities: Array<{ id: string; name: string; entity_type: string }>;
}

const SOURCE_LABEL: Record<string, string> = {
  text: 'texto',
  voice: 'voz',
  image: 'imagen',
  pdf: 'pdf',
  xlsx: 'hoja',
  md: 'markdown',
  url: 'url',
};

const ORIGIN_LABEL: Record<string, string> = {
  interview: 'entrevista',
  batch_import: 'importación',
  next_step_completion: 'paso completado',
};

export function TimelineClient({ projects, entities }: Props) {
  const [filters, setFilters] = useState<Filters>({});
  const [items, setItems] = useState<EnrichedMemory[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialLoaded, setInitialLoaded] = useState(false);

  const sentinelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (resetCursor: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchJson('/api/timeline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filters,
            cursor: resetCursor ? undefined : cursor ?? undefined,
            limit: 40,
          }),
        });

        setItems((prev) =>
          resetCursor ? data.items : [...prev, ...data.items]
        );
        setCursor(data.next_cursor);
        setHasMore(data.has_more);
        setInitialLoaded(true);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [filters, cursor]
  );

  // Recargar cuando cambian los filtros
  useEffect(() => {
    setItems([]);
    setCursor(null);
    setHasMore(false);
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters)]);

  // Infinite scroll: cargar más al ver el sentinel
  useEffect(() => {
    if (!sentinelRef.current) return;
    if (!hasMore || loading) return;
    const sentinel = sentinelRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading && hasMore) {
          load(false);
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, load]);

  // Agrupar por día
  const groups: Array<{ day: string; items: EnrichedMemory[] }> = [];
  let lastDay = '';
  for (const it of items) {
    const day = it.captured_at.slice(0, 10);
    if (day !== lastDay) {
      groups.push({ day, items: [it] });
      lastDay = day;
    } else {
      groups[groups.length - 1].items.push(it);
    }
  }

  return (
    <>
      <SearchFilters
        value={filters}
        onChange={setFilters}
        projects={projects}
        entities={entities}
      />

      {error && (
        <div className={styles.error}>
          <strong>Error</strong> · {error}
        </div>
      )}

      {initialLoaded && items.length === 0 && !loading && (
        <p className={styles.empty}>
          Sin memorias para los filtros aplicados.
        </p>
      )}

      <div className={styles.list}>
        {groups.map((g) => (
          <section key={g.day} className={styles.dayGroup}>
            <header className={styles.dayHead}>
              <span className={styles.dayDot} />
              <h3 className={styles.dayLabel}>{formatDay(g.day)}</h3>
              <span className={styles.dayCount}>
                {g.items.length} memoria{g.items.length === 1 ? '' : 's'}
              </span>
            </header>
            <ol className={styles.dayItems}>
              {g.items.map((m) => (
                <li key={m.id} className={styles.item}>
                  <div className={styles.itemTop}>
                    <span className={styles.timestamp}>
                      {new Date(m.captured_at).toLocaleTimeString('es-ES', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <span className={styles.source}>
                      {SOURCE_LABEL[m.source_type] || m.source_type}
                    </span>
                    {(m.source_metadata as any)?.origin && ORIGIN_LABEL[(m.source_metadata as any).origin] && (
                      <span className={styles.origin}>
                        {ORIGIN_LABEL[(m.source_metadata as any).origin]}
                      </span>
                    )}
                  </div>
                  <p className={styles.text}>{m.summary || m.content}</p>
                  {(m.projects.length > 0 || m.entities.length > 0) && (
                    <div className={styles.tags}>
                      {m.projects.map((p) => (
                        <Link
                          key={p.id}
                          href={`/projects/${p.slug}`}
                          className={styles.projTag}
                        >
                          ✦ {p.name}
                        </Link>
                      ))}
                      {m.entities.map((e) => (
                        <Link
                          key={e.id}
                          href={`/entities/${e.id}`}
                          className={styles.entTag}
                        >
                          ◇ {e.name}
                        </Link>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>

      <div ref={sentinelRef} className={styles.sentinel}>
        {loading && (
          <div className={styles.loadingBar}>
            <span />
            <span />
            <span />
          </div>
        )}
        {!loading && !hasMore && items.length > 0 && (
          <p className={styles.endNote}>· fin del histórico ·</p>
        )}
      </div>
    </>
  );
}

function formatDay(day: string): string {
  const d = new Date(day + 'T12:00:00');
  const now = new Date();
  const diffDays = Math.floor(
    (new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) /
      86400_000
  );
  if (diffDays === 0) return 'Hoy';
  if (diffDays === 1) return 'Ayer';
  if (diffDays < 7) {
    return d.toLocaleDateString('es-ES', { weekday: 'long' });
  }
  return d.toLocaleDateString('es-ES', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}
