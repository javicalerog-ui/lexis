'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './EntitySummaryCard.module.css';

interface KeyFacts {
  rol?: string | null;
  organization?: string | null;
  location?: string | null;
  relationship?: string | null;
  context?: string | null;
}

interface SummaryPayload {
  summary: string;
  key_facts: KeyFacts;
  highlights: string[];
  open_threads: string[];
  confidence: number;
  generated_at: string;
  model_used: string;
  memories_considered: number;
}

interface Props {
  entityId: string;
  initialPayload: SummaryPayload | null;
  initialSummary: string | null;
  initialUpdatedAt: string | null;
  summaryStale: boolean;
  interactionCount: number;
}

const FACT_LABELS: Record<keyof KeyFacts, string> = {
  rol: 'Rol',
  organization: 'Organización',
  location: 'Ubicación',
  relationship: 'Relación',
  context: 'Contexto',
};

export function EntitySummaryCard({
  entityId,
  initialPayload,
  initialSummary,
  initialUpdatedAt,
  summaryStale,
  interactionCount,
}: Props) {
  const router = useRouter();
  const [payload, setPayload] = useState<SummaryPayload | null>(initialPayload);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fallback: si no hay payload completo pero sí summary plano (caso pre-Sprint 6),
  // mostramos solo eso.
  const displaySummary = payload?.summary ?? initialSummary;
  const updatedAt = payload?.generated_at ?? initialUpdatedAt;
  const hasRichData =
    !!payload &&
    (payload.highlights?.length > 0 ||
      payload.open_threads?.length > 0 ||
      Object.values(payload.key_facts || {}).some((v) => v));

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/entities/${entityId}/refresh-summary`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error);
      if (data.summary) {
        setPayload({
          summary: data.summary,
          key_facts: data.key_facts,
          highlights: data.highlights,
          open_threads: data.open_threads,
          confidence: data.confidence,
          generated_at: data.generated_at,
          model_used: data.model_used,
          memories_considered: data.memories_considered,
        });
        router.refresh();
      } else if (data.reason === 'no_memories') {
        setPayload(null);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  // No hay memorias suficientes → estado vacío con CTA
  if (interactionCount === 0) {
    return (
      <section className={styles.cardEmpty}>
        <p className={styles.emptyText}>
          Aún no hay memorias que mencionen esta entidad. La síntesis se
          generará automáticamente cuando capture al menos una.
        </p>
      </section>
    );
  }

  // No hay summary aún
  if (!displaySummary) {
    return (
      <section className={styles.cardEmpty}>
        <p className={styles.emptyText}>
          Hay {interactionCount} memoria{interactionCount === 1 ? '' : 's'} sobre
          esta entidad pero todavía no se ha generado una síntesis.
        </p>
        <button onClick={refresh} disabled={busy} className={styles.cta}>
          {busy ? (
            <span className={styles.spin}><span /><span /><span /></span>
          ) : (
            'Generar síntesis'
          )}
        </button>
        {error && <p className={styles.error}>{error}</p>}
      </section>
    );
  }

  return (
    <section className={styles.card}>
      <header className={styles.cardHead}>
        <div className={styles.headLeft}>
          <span className={styles.glyph} aria-hidden>◇</span>
          <div>
            <h2 className={styles.cardTitle}>Síntesis</h2>
            {updatedAt && (
              <p className={styles.cardMeta}>
                {relativeTime(updatedAt)}
                {summaryStale && (
                  <>
                    {' · '}
                    <span className={styles.staleFlag}>actualizable</span>
                  </>
                )}
                {payload && (
                  <>
                    {' · '}
                    <span>{payload.memories_considered} memorias</span>
                  </>
                )}
                {payload && (
                  <>
                    {' · '}
                    <span>conf {Math.round(payload.confidence * 100)}%</span>
                  </>
                )}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={refresh}
          disabled={busy}
          className={styles.refreshBtn}
          title="Regenerar"
        >
          {busy ? (
            <span className={styles.spin}><span /><span /><span /></span>
          ) : (
            '↻'
          )}
        </button>
      </header>

      <p className={styles.summaryText}>{displaySummary}</p>

      {error && <p className={styles.error}>{error}</p>}

      {hasRichData && payload && (
        <>
          {Object.values(payload.key_facts || {}).some((v) => v) && (
            <div className={styles.factsGrid}>
              {(Object.entries(payload.key_facts) as Array<[keyof KeyFacts, string | null]>).map(
                ([k, v]) =>
                  v ? (
                    <div key={k} className={styles.fact}>
                      <span className={styles.factKey}>{FACT_LABELS[k] || k}</span>
                      <span className={styles.factVal}>{v}</span>
                    </div>
                  ) : null
              )}
            </div>
          )}

          {payload.highlights?.length > 0 && (
            <div className={styles.subBlock}>
              <h3 className={styles.subTitle}>
                <span className={styles.subDotAccent} />
                Lo destacado
              </h3>
              <ul className={styles.bulletList}>
                {payload.highlights.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            </div>
          )}

          {payload.open_threads?.length > 0 && (
            <div className={styles.subBlock}>
              <h3 className={styles.subTitle}>
                <span className={styles.subDotViolet} />
                Hilos abiertos
              </h3>
              <ul className={styles.bulletList}>
                {payload.open_threads.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'recién generado';
  if (min < 60) return `hace ${min}min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr}h`;
  const d = Math.floor(hr / 24);
  return `hace ${d}d`;
}
