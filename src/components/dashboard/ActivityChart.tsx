'use client';

import { useMemo } from 'react';
import styles from './ActivityChart.module.css';

interface Bucket {
  bucket: string;
  count: number;
}

interface Props {
  buckets: Bucket[];
}

const WIDTH = 720;
const HEIGHT = 200;
const PADDING = { top: 24, right: 16, bottom: 28, left: 32 };

export function ActivityChart({ buckets }: Props) {
  const chartData = useMemo(() => {
    // Asegurar 13 semanas; rellenar con 0 si faltan
    const now = new Date();
    const weeks: Bucket[] = [];
    for (let i = 12; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i * 7);
      // Truncar al lunes (UTC, igual que date_trunc('week') de Postgres)
      const day = d.getUTCDay();
      const diff = (day === 0 ? -6 : 1) - day;
      d.setUTCDate(d.getUTCDate() + diff);
      d.setUTCHours(0, 0, 0, 0);
      const iso = d.toISOString();
      const match = buckets.find(
        (b) => Math.abs(new Date(b.bucket).getTime() - d.getTime()) < 86400_000 * 3.5
      );
      weeks.push({ bucket: iso, count: match?.count ?? 0 });
    }
    return weeks;
  }, [buckets]);

  const max = Math.max(1, ...chartData.map((b) => b.count));
  const innerW = WIDTH - PADDING.left - PADDING.right;
  const innerH = HEIGHT - PADDING.top - PADDING.bottom;
  const barWidth = (innerW / chartData.length) * 0.7;
  const gap = (innerW / chartData.length) * 0.3;

  return (
    <div className={styles.wrap}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className={styles.svg}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="actGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7ba8ff" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#4f8eff" stopOpacity="0.5" />
          </linearGradient>
          <linearGradient id="actGradHover" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#cc7bff" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#b347ff" stopOpacity="0.6" />
          </linearGradient>
        </defs>

        {/* Y-axis grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <g key={p}>
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={PADDING.top + innerH * (1 - p)}
              y2={PADDING.top + innerH * (1 - p)}
              stroke="rgba(120,145,220,0.08)"
              strokeWidth="1"
              strokeDasharray={p === 0 ? '0' : '3,3'}
            />
            <text
              x={PADDING.left - 8}
              y={PADDING.top + innerH * (1 - p)}
              textAnchor="end"
              dominantBaseline="middle"
              fill="#5e6786"
              fontSize="10"
              fontFamily="JetBrains Mono, monospace"
            >
              {Math.round(max * p)}
            </text>
          </g>
        ))}

        {/* Bars */}
        {chartData.map((b, i) => {
          const h = (b.count / max) * innerH;
          const x = PADDING.left + i * (barWidth + gap) + gap / 2;
          const y = PADDING.top + innerH - h;
          const d = new Date(b.bucket);
          const label = `${d.getUTCDate()} ${d.toLocaleDateString('es-ES', { month: 'short' })}`;
          return (
            <g key={i} className={styles.bar}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(2, h)}
                fill="url(#actGrad)"
                rx="3"
              >
                <title>{`${label}: ${b.count} memorias`}</title>
              </rect>
              {/* Count label sobre la barra si > 0 */}
              {b.count > 0 && (
                <text
                  x={x + barWidth / 2}
                  y={y - 6}
                  textAnchor="middle"
                  fill="#c8cfe1"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                  fontWeight="500"
                >
                  {b.count}
                </text>
              )}
              {/* X-axis label (cada 2 semanas para no saturar) */}
              {i % 2 === 0 && (
                <text
                  x={x + barWidth / 2}
                  y={HEIGHT - 8}
                  textAnchor="middle"
                  fill="#5e6786"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
