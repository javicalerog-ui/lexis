'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { VoiceRecorder } from '@/components/audio/VoiceRecorder';
import { PlayQuestionButton } from '@/components/audio/PlayQuestionButton';
import { fetchJson } from '@/lib/fetch-json';
import styles from './InterviewChat.module.css';

interface Message {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  memory_id?: string | null;
  topic_shift?: boolean | null;
}

interface Props {
  sessionId: string;
  initialMessages: Message[];
  initialStatus: 'active' | 'paused' | 'completed';
}

export function InterviewChat({
  sessionId,
  initialMessages,
  initialStatus,
}: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'active' | 'paused' | 'completed'>(
    initialStatus
  );
  const [saturated, setSaturated] = useState(false);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: 999_999, behavior: 'smooth' });
  }, [messages.length]);

  function autosize() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }

  const send = useCallback(async () => {
    if (busy || !draft.trim() || status !== 'active') return;
    const userText = draft.trim();
    setDraft('');
    autosize();
    setError(null);
    setBusy(true);

    // Optimistic: añadir turno del usuario inmediatamente
    const tempId = `tmp-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: tempId, role: 'user', content: userText },
    ]);

    try {
      const data = await fetchJson(`/api/interview/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText }),
      });

      setMessages((prev) => {
        const next = prev.filter((m) => m.id !== tempId);
        next.push({
          id: data.user_message_id,
          role: 'user',
          content: userText,
          memory_id: data.memory_id,
        });
        if (data.next_question && data.assistant_message) {
          next.push({
            id: data.assistant_message.id,
            role: 'assistant',
            content: data.assistant_message.content,
            topic_shift: data.assistant_message.topic_shift,
          });
        }
        return next;
      });

      if (data.saturated) {
        setSaturated(true);
      }
    } catch (e) {
      setError(String(e));
      // Quitar el optimistic en caso de error
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setDraft(userText);
    } finally {
      setBusy(false);
    }
  }, [busy, draft, sessionId, status]);

  async function completeSession() {
    if (busy) return;
    setBusy(true);
    try {
      await fetchJson(`/api/interview/${sessionId}/complete`, {
        method: 'POST',
      });
      setStatus('completed');
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <>
      <div ref={listRef} className={styles.scroll}>
        <div className={styles.list}>
          {messages.length === 0 && (
            <div className={styles.empty}>
              <p>La entrevista aún no ha empezado.</p>
            </div>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              className={`${styles.msg} ${
                m.role === 'assistant' ? styles.msgAssistant : styles.msgUser
              }`}
            >
              {m.role === 'assistant' && (
                <div className={styles.assistantTop}>
                  <span className={styles.role}>
                    {m.topic_shift ? '☞ nuevo tema' : 'pregunta'}
                  </span>
                  <PlayQuestionButton text={m.content} cacheKey={m.id} />
                </div>
              )}
              <div className={styles.bubble}>{m.content}</div>
              {m.role === 'user' && m.memory_id && (
                <span className={styles.memTag}>memoria capturada ✓</span>
              )}
            </div>
          ))}

          {busy && (
            <div className={styles.thinking}>
              <span /><span /><span />
            </div>
          )}

          {error && (
            <div className={styles.error}>
              <strong>Error</strong> · {error}
            </div>
          )}

          {saturated && status === 'active' && (
            <div className={styles.satNotice}>
              <p>
                He extraído bastante de este tema. Si quieres seguir, pregunta tú
                lo que quieras o pulsa <strong>Cerrar sesión</strong>.
              </p>
            </div>
          )}

          {status === 'completed' && (
            <div className={styles.satNotice}>
              <p>Sesión cerrada. Lo capturado ya está en el grafo.</p>
            </div>
          )}
        </div>
      </div>

      {status === 'active' && (
        <div className={styles.inputBar}>
          <div className={styles.inputRow}>
            <textarea
              ref={taRef}
              rows={1}
              value={draft}
              placeholder="Tu respuesta…"
              disabled={busy}
              onChange={(e) => {
                setDraft(e.target.value);
                autosize();
              }}
              onKeyDown={handleKey}
              className={styles.ta}
            />
            <div className={styles.voiceSlot}>
              <VoiceRecorder
                disabled={busy}
                reviewBeforeSubmit={true}
                prompt="Entrevista en español: nombres propios, proyectos, organizaciones."
                onTranscript={(text) => {
                  // Reemplazamos el draft con la transcripción revisada por el user
                  setDraft(text);
                  setTimeout(autosize, 0);
                  taRef.current?.focus();
                }}
              />
            </div>
            <button
              onClick={send}
              disabled={busy || !draft.trim()}
              className={styles.sendBtn}
              aria-label="Enviar"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
          <button
            onClick={completeSession}
            className={styles.closeBtn}
            disabled={busy}
          >
            Cerrar sesión
          </button>
        </div>
      )}
    </>
  );
}
