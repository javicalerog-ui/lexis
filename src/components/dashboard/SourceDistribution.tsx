'use client';

import styles from './SourceDistribution.module.css';

const SOURCE_LABEL: Record<string, string> = {
  text: 'Texto',
  voice: 'Voz',
  image: 'Imagen',
  pdf: 'PDF',
  xlsx: 'Hoja de cálculo',
  md: 'Markdown',
  url: 'URL',
};

const SOURCE_GLYPH: Record<string, string> = {
  text: 'T',
  voice: '◉',
  image: '▢',
  pdf: '▤',
  xlsx: '▦',
  md: '↳',
  url: '⌘',
};

interface Props {
  data: Record<string, number>;
}

export function SourceDistribution({ data }: Props) {
  const entries = Object.entries(data).sort(([, a], [, b]) => b - a);
  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  const max = Math.max(1, ...entries.map(([, v]) => v));

  if (!entries.length) {
    return <p className={styles.empty}>Sin datos todavía.</p>;
  }

  return (
    <ul className={styles.list}>
      {entries.map(([type, count]) => {
        const pct = (count / max) * 100;
        const share = ((count / total) * 100).toFixed(0);
        return (
          <li key={type} className={styles.row}>
            <span className={styles.label}>
              <span className={styles.glyph}>{SOURCE_GLYPH[type] || '?'}</span>
              {SOURCE_LABEL[type] || type}
            </span>
            <span className={styles.track}>
              <span
                className={styles.fill}
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className={styles.count}>
              {count} <span className={styles.share}>· {share}%</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
