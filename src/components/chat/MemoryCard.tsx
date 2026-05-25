'use client';

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
  const date = new Date(result.captured_at).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const pct = Math.round(result.similarity * 100);
  const intensity = Math.min(1, Math.max(0, (result.similarity - 0.4) / 0.5));

  return (
    <article className={styles.card}>
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
      <p className={styles.content}>{result.summary || result.content}</p>
    </article>
  );
}
