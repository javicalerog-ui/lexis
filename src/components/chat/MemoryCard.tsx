'use client';

import { useState } from 'react';
import type { MemorySearchResult } from '@/types/domain';
import styles from './MemoryCard.module.css';

const TYPE_LABEL: Record<string, string> = {
  text: 'texto',
  voice: 'voz',
  image: 'imagen',
  pdf: 'pdf',
  xlsx: 'hoja',
  md: 'nota',
  url: 'enlace',
};

interface Props {
  result: MemorySearchResult;
}

export function MemoryCard({ result }: Props) {
  const [expanded, setExpanded] = useState(false);
  const date = new Date(result.captured_at).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const pct = Math.round(result.similarity * 100);
  const intensity = Math.min(1, Math.max(0, (result.similarity - 0.4) / 0.5));
  const full = result.summary || result.content || '';
  // Solo tiene sentido "ver todo" si el texto se está recortando (>~3 líneas).
  const expandable = full.length > 160;

  return (
    <article
      className={`${styles.card} ${expandable ? styles.cardClickable : ''}`}
      onClick={expandable ? () => setExpanded((v) => !v) : undefined}
      role={expandable ? 'button' : undefined}
      tabIndex={expandable ? 0 : undefined}
      onKeyDown={
        expandable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setExpanded((v) => !v);
              }
            }
          : undefined
      }
    >
      <header className={styles.head}>
        <span className={styles.type}>{TYPE_LABEL[result.source_type] || result.source_type}</span>
        <span className={styles.date}>{date}</span>
        <span
          className={styles.score}
          style={{ ['--intensity' as any]: intensity }}
          title={`${pct}% similar`}
        >
          {pct}%
        </span>
      </header>
      <p className={expanded ? styles.contentFull : styles.content}>{full}</p>
      {expandable && (
        <span className={styles.expandHint}>{expanded ? '▲ menos' : '▼ ver todo'}</span>
      )}
    </article>
  );
}
