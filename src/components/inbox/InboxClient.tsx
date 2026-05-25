'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { VoiceRecorder } from '@/components/audio/VoiceRecorder';
import styles from './InboxClient.module.css';

interface QuickReply {
  label: string;
  action: string;
  payload?: Record<string, unknown>;
}

interface AgentAction {
  id: string;
  type: string;
  title: string;
  prompt: string;
  context: Record<string, unknown>;
  quick_replies: QuickReply[];
  open_route: string | null;
  status: 'pending' | 'responded' | 'dismissed' | 'expired';
  response: any;
  responded_at: string | null;
  expires_at: string | null;
  created_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  responded: 'Respondida',
  dismissed: 'Descartada',
  expired: 'Caducada',
};

export function InboxClient({
  initialActions,
}: {
  initialActions: AgentAction[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const focusedId = params.get('action');
  const focusedQuickAction = params.get('quick');

  const [actions, setActions] = useState<AgentAction[]>(initialActions);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [voiceTarget, setVoiceTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Si vienen con ?action=ID&quick=X (deep link de push action), responder al toque
  useEffect(() => {
    if (!focusedId) return;
    if (focusedQuickAction) {
      const target = actions.find((a) => a.id === focusedId);
      const qr = target?.quick_replies?.find((q) => q.action === focusedQuickAction);
      if (target && target.status === 'pending' && qr) {
        respond(target.id, qr);
        // Limpia la URL
        router.replace('/inbox');
      }
    } else {
      // Scroll a la action
      setTimeout(() => {
        const el = document.getElementById(`action-${focusedId}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [focusedId, focusedQuickAction]);

  async function refresh() {
    try {
      const res = await fetch('/api/agent-actions');
      const data = await res.json();
      setActions(data.actions || []);
    } catch (e) {
      setError(String(e));
    }
  }

  async function respond(actionId: string, qr: QuickReply) {
    setBusy(actionId); setError(null);
    try {
      // Si la acción es open_route, abrir la ruta sin marcar como respondida
      const target = actions.find((a) => a.id === actionId);
      if (qr.action === 'open_route' && target?.open_route) {
        // Marcamos como respondida con esa acción
        await fetch(`/api/agent-actions/${actionId}/respond`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: qr.action, payload: qr.payload || {} }),
        });
        router.push(target.open_route);
        return;
      }

      const res = await fetch(`/api/agent-actions/${actionId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: qr.action, payload: qr.payload || {} }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function dismiss(actionId: string) {
    setBusy(actionId); setError(null);
    try {
      const res = await fetch(`/api/agent-actions/${actionId}/respond`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || data.error);
      }
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function sendVoiceReply(text: string) {
    if (!voiceTarget) return;
    setBusy(voiceTarget); setError(null);
    try {
      const res = await fetch(`/api/agent-actions/${voiceTarget}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'voice_note',
          voice_transcript: text,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error);
      setVoiceTarget(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  const visibleActions = actions.filter((a) =>
    filter === 'pending' ? a.status === 'pending' : true
  );
  const pendingCount = actions.filter((a) => a.status === 'pending').length;

  return (
    <div>
      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.tabs}>
        <button
          onClick={() => setFilter('pending')}
          className={`${styles.tab} ${filter === 'pending' ? styles.tabActive : ''}`}
        >
          Pendientes
          {pendingCount > 0 && <span className={styles.badge}>{pendingCount}</span>}
        </button>
        <button
          onClick={() => setFilter('all')}
          className={`${styles.tab} ${filter === 'all' ? styles.tabActive : ''}`}
        >
          Todas
        </button>
      </div>

      {visibleActions.length === 0 && (
        <div className={styles.empty}>
          <span className={styles.emptyGlyph}>○</span>
          <p>
            {filter === 'pending'
              ? 'Bandeja vacía. Lexis no necesita nada de ti ahora mismo.'
              : 'No hay historial de acciones todavía.'}
          </p>
        </div>
      )}

      <ul className={styles.list}>
        {visibleActions.map((a) => (
          <li
            key={a.id}
            id={`action-${a.id}`}
            className={`${styles.card} ${a.status !== 'pending' ? styles.cardDone : ''} ${focusedId === a.id ? styles.cardFocused : ''}`}
          >
            <div className={styles.cardHead}>
              <h3 className={styles.cardTitle}>{a.title}</h3>
              <span className={`${styles.status} ${styles[`status_${a.status}`]}`}>
                {STATUS_LABELS[a.status]}
              </span>
            </div>
            <p className={styles.cardPrompt}>{a.prompt}</p>

            <div className={styles.cardMeta}>
              <time className={styles.metaItem}>
                {new Date(a.created_at).toLocaleString('es-ES', {
                  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                  hourCycle: 'h23',
                })}
              </time>
              {a.expires_at && a.status === 'pending' && (
                <span className={styles.metaItem}>
                  caduca {new Date(a.expires_at).toLocaleDateString('es-ES')}
                </span>
              )}
            </div>

            {a.status === 'pending' && (
              <>
                <div className={styles.quickReplies}>
                  {a.quick_replies.map((qr, idx) => (
                    <button
                      key={idx}
                      onClick={() => respond(a.id, qr)}
                      disabled={busy === a.id}
                      className={`${styles.replyBtn} ${idx === 0 ? styles.replyBtnPrimary : ''}`}
                    >
                      {qr.label}
                    </button>
                  ))}
                  <button
                    onClick={() => setVoiceTarget(a.id)}
                    disabled={busy === a.id}
                    className={styles.voiceBtn}
                    title="Responder por voz"
                  >
                    ◉
                  </button>
                  <button
                    onClick={() => dismiss(a.id)}
                    disabled={busy === a.id}
                    className={styles.dismissBtn}
                  >
                    Descartar
                  </button>
                </div>

                {voiceTarget === a.id && (
                  <div className={styles.voiceBox}>
                    <p className={styles.voiceHint}>
                      Responde por voz. Tu respuesta se guarda como memoria vinculada a esta acción.
                    </p>
                    <VoiceRecorder
                      onTranscript={sendVoiceReply}
                      reviewBeforeSubmit={true}
                      disabled={busy === a.id}
                    />
                    <button onClick={() => setVoiceTarget(null)} className={styles.voiceCancelBtn}>
                      Cancelar
                    </button>
                  </div>
                )}
              </>
            )}

            {a.status === 'responded' && a.response && (
              <div className={styles.responseShow}>
                Respondido con <strong>{a.response.action}</strong>
                {a.response.voice_transcript && (
                  <div className={styles.voiceTranscript}>"{a.response.voice_transcript}"</div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
