'use client';

import { MemoryCard } from './MemoryCard';
import type { MemorySearchResult } from '@/types/domain';
import styles from './MessageList.module.css';

export type Message =
  | { id: string; kind: 'user_input'; text: string; meta?: string }
  | { id: string; kind: 'system'; text: string; meta?: string }
  | { id: string; kind: 'results'; text: string; results?: MemorySearchResult[] }
  | { id: string; kind: 'error'; text: string };

interface Props {
  messages: Message[];
  mode: 'capture' | 'search';
}

export function MessageList({ messages, mode }: Props) {
  if (!messages.length) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyHalo} aria-hidden />
        <h2 className={styles.emptyTitle}>
          {mode === 'capture' ? 'Empieza a capturar' : 'Pregúntale a tu memoria'}
        </h2>
        <p className={styles.emptyHint}>
          {mode === 'capture'
            ? 'Texto, voz, PDFs, hojas, imágenes. Todo entra. Todo se recuerda.'
            : 'Lenguaje natural. Sin filtros, sin tags. Solo describe lo que buscas.'}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.list}>
      {messages.map((m) => (
        <div key={m.id} className={styles.row}>
          {m.kind === 'user_input' && (
            <div className={styles.user}>
              <div className={styles.userBubble}>{m.text}</div>
              {m.meta && <span className={styles.userMeta}>{m.meta}</span>}
            </div>
          )}

          {m.kind === 'system' && (
            <div className={styles.system}>
              <div className={styles.systemHeader}>
                <span className={styles.systemDot} />
                <span className={styles.systemLabel}>
                  {m.meta || 'memoria guardada'}
                </span>
              </div>
              <div className={styles.systemText}>{m.text}</div>
            </div>
          )}

          {m.kind === 'results' && (
            <div className={styles.system}>
              <div className={styles.systemHeader}>
                <span className={styles.systemDot} />
                <span className={styles.systemLabel}>{m.text}</span>
              </div>
              {m.results && m.results.length > 0 && (
                <div className={styles.results}>
                  {m.results.map((r) => (
                    <MemoryCard key={r.id} result={r} />
                  ))}
                </div>
              )}
            </div>
          )}

          {m.kind === 'error' && (
            <div className={styles.error}>
              <strong>Error</strong> · {m.text}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
