'use client';

import { MemoryCard } from './MemoryCard';
import type { MemorySearchResult } from '@/types/domain';
import styles from './MessageList.module.css';

export type Message =
  | { id: string; kind: 'user_input'; text: string; meta?: string }
  | { id: string; kind: 'system'; text: string; meta?: string }
  | { id: string; kind: 'results'; text: string; results?: MemorySearchResult[] }
  | { id: string; kind: 'answer'; text: string; meta?: string; pending?: boolean }
  | { id: string; kind: 'error'; text: string };

interface Props {
  messages: Message[];
  mode: 'capture' | 'search';
}

/**
 * Render seguro del markdown ligero de la respuesta (síntesis RAG):
 * párrafos, listas "- ", **negritas** y citas [n] — todo como elementos
 * React, sin HTML crudo (nunca dangerouslySetInnerHTML).
 */
function FormattedAnswer({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: Array<{ type: 'p' | 'ul'; lines: string[] }> = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const isItem = /^[-•]\s+/.test(line.trim());
    const last = blocks[blocks.length - 1];
    if (isItem) {
      if (last?.type === 'ul') last.lines.push(line.trim().replace(/^[-•]\s+/, ''));
      else blocks.push({ type: 'ul', lines: [line.trim().replace(/^[-•]\s+/, '')] });
    } else {
      blocks.push({ type: 'p', lines: [line.trim()] });
    }
  }

  function renderInline(s: string, keyPrefix: string) {
    // Trocear por **negritas** y citas [1] / [1, 2]
    const parts = s.split(/(\*\*[^*]+\*\*|\[\d+(?:\s*,\s*\d+)*\])/g);
    return parts.map((part, i) => {
      if (/^\*\*[^*]+\*\*$/.test(part)) {
        return <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>;
      }
      if (/^\[\d+(?:\s*,\s*\d+)*\]$/.test(part)) {
        return (
          <span key={`${keyPrefix}-${i}`} className={styles.cite}>
            {part}
          </span>
        );
      }
      return <span key={`${keyPrefix}-${i}`}>{part}</span>;
    });
  }

  return (
    <div className={styles.answerText}>
      {blocks.map((b, bi) =>
        b.type === 'ul' ? (
          <ul key={bi} className={styles.answerList}>
            {b.lines.map((l, li) => (
              <li key={li}>{renderInline(l, `${bi}-${li}`)}</li>
            ))}
          </ul>
        ) : (
          <p key={bi}>{renderInline(b.lines[0], `${bi}`)}</p>
        )
      )}
    </div>
  );
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

          {m.kind === 'answer' && (
            <div className={styles.answer}>
              <div className={styles.systemHeader}>
                <span className={styles.answerDot} />
                <span className={styles.systemLabel}>
                  {m.pending ? 'sintetizando respuesta…' : m.meta || 'respuesta'}
                </span>
              </div>
              {m.pending ? (
                <div className={styles.answerPending}>
                  Leyendo tus memorias y redactando…
                </div>
              ) : (
                <FormattedAnswer text={m.text} />
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
