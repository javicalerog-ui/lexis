'use client';

import { useState, useEffect, useRef } from 'react';
import { useMediaRecorder } from '@/hooks/useMediaRecorder';
import styles from './VoiceRecorder.module.css';

interface Props {
  /** Se llama con la transcripción final (texto). El consumer decide qué hacer con ella. */
  onTranscript: (text: string) => void;
  /** Hint opcional para Whisper: nombres propios, contexto, etc. */
  prompt?: string;
  /** Si es true, muestra el texto transcrito antes de devolverlo para que el user lo edite. */
  reviewBeforeSubmit?: boolean;
  disabled?: boolean;
}

export function VoiceRecorder({
  onTranscript,
  prompt,
  reviewBeforeSubmit = true,
  disabled,
}: Props) {
  const recorder = useMediaRecorder({ maxDurationMs: 180_000 });
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showReview, setShowReview] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (showReview && taRef.current) {
      taRef.current.style.height = 'auto';
      taRef.current.style.height = Math.min(taRef.current.scrollHeight, 240) + 'px';
      taRef.current.focus();
    }
  }, [showReview]);

  function formatElapsed(ms: number) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  async function handleStop() {
    setError(null);
    const blob = await recorder.stop();
    if (!blob) return;

    setTranscribing(true);
    try {
      const form = new FormData();
      form.append('audio', blob, 'recording.webm');
      form.append('language', 'es');
      if (prompt) form.append('prompt', prompt);

      const res = await fetch('/api/audio/transcribe', {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error);

      if (reviewBeforeSubmit) {
        setTranscript(data.text);
        setShowReview(true);
      } else {
        onTranscript(data.text);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setTranscribing(false);
    }
  }

  function confirmTranscript() {
    if (!transcript.trim()) return;
    onTranscript(transcript.trim());
    setTranscript('');
    setShowReview(false);
  }

  function discardTranscript() {
    setTranscript('');
    setShowReview(false);
  }

  // ---------- Estados de render ----------

  if (showReview) {
    return (
      <div className={styles.reviewBox}>
        <div className={styles.reviewHeader}>
          <span className={styles.reviewLabel}>Revisar transcripción</span>
          <button onClick={discardTranscript} className={styles.iconButton} title="Descartar">
            ×
          </button>
        </div>
        <textarea
          ref={taRef}
          value={transcript}
          onChange={(e) => {
            setTranscript(e.target.value);
            if (e.target) {
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 240) + 'px';
            }
          }}
          className={styles.reviewTa}
        />
        <div className={styles.reviewActions}>
          <button onClick={discardTranscript} className={styles.btnGhost}>
            Cancelar
          </button>
          <button
            onClick={confirmTranscript}
            disabled={!transcript.trim()}
            className={styles.btnPrimary}
          >
            Usar texto
          </button>
        </div>
      </div>
    );
  }

  if (transcribing) {
    return (
      <div className={styles.busy}>
        <span className={styles.dots}>
          <span /><span /><span />
        </span>
        <span className={styles.busyText}>Transcribiendo…</span>
      </div>
    );
  }

  if (recorder.state === 'recording') {
    return (
      <div className={styles.recording}>
        <button
          onClick={() => recorder.cancel()}
          className={styles.iconCancel}
          title="Cancelar"
        >
          ×
        </button>
        <div className={styles.waveWrap}>
          <span className={styles.waveDot} style={{ animationDelay: '0ms' }} />
          <span
            className={styles.waveBar}
            style={{ transform: `scaleY(${0.3 + recorder.level * 0.7})` }}
          />
          <span className={styles.timer}>{formatElapsed(recorder.elapsedMs)}</span>
        </div>
        <button onClick={handleStop} className={styles.iconStop} title="Parar y transcribir">
          ■
        </button>
      </div>
    );
  }

  // idle / error
  return (
    <>
      <button
        type="button"
        onClick={() => recorder.start()}
        disabled={disabled}
        className={styles.iconMic}
        title="Grabar"
        aria-label="Grabar audio"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="2" width="6" height="13" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0" />
          <line x1="12" y1="18" x2="12" y2="22" />
          <line x1="8" y1="22" x2="16" y2="22" />
        </svg>
      </button>
      {error && <span className={styles.error}>{error.slice(0, 60)}</span>}
      {recorder.error && (
        <span className={styles.error}>{recorder.error.slice(0, 60)}</span>
      )}
    </>
  );
}
