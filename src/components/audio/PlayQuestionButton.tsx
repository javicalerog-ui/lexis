'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './PlayQuestionButton.module.css';

interface Props {
  text: string;
  /** Si se proporciona, se cachea el audio en memoria por id. */
  cacheKey?: string;
}

// Cache simple en memoria por sesión: ahorra llamadas si re-pulsas.
const AUDIO_CACHE = new Map<string, string>();

export function PlayQuestionButton({ text, cacheKey }: Props) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      const a = audioRef.current;
      if (a) {
        a.pause();
        a.src = '';
      }
    };
  }, []);

  async function play() {
    if (state === 'loading') return;

    // Si ya está reproduciendo, parar y volver a idle.
    if (state === 'playing' && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setState('idle');
      return;
    }

    setError(null);

    // Reuse cache
    const cached = cacheKey ? AUDIO_CACHE.get(cacheKey) : undefined;
    if (cached) {
      playUrl(cached);
      return;
    }

    setState('loading');
    try {
      const res = await fetch('/api/audio/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || err.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (cacheKey) AUDIO_CACHE.set(cacheKey, url);
      playUrl(url);
    } catch (e) {
      setError(String(e).slice(0, 80));
      setState('idle');
    }
  }

  function playUrl(url: string) {
    let audio = audioRef.current;
    if (!audio) {
      audio = new Audio();
      audio.onended = () => setState('idle');
      audio.onerror = () => {
        setError('No se pudo reproducir el audio');
        setState('idle');
      };
      audioRef.current = audio;
    }
    audio.src = url;
    audio.play().then(
      () => setState('playing'),
      (e) => {
        setError(String(e).slice(0, 80));
        setState('idle');
      }
    );
  }

  return (
    <button
      type="button"
      onClick={play}
      className={`${styles.btn} ${state === 'playing' ? styles.playing : ''}`}
      title={state === 'playing' ? 'Parar' : 'Escuchar pregunta'}
      aria-label="Escuchar"
    >
      {state === 'loading' && <span className={styles.dots}><span /><span /><span /></span>}
      {state === 'idle' && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M7 4l12 8-12 8z" />
        </svg>
      )}
      {state === 'playing' && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="5" width="4" height="14" rx="1" />
          <rect x="14" y="5" width="4" height="14" rx="1" />
        </svg>
      )}
      {error && <span className={styles.err}>{error}</span>}
    </button>
  );
}
