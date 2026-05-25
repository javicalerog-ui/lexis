'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type RecorderState = 'idle' | 'requesting' | 'recording' | 'stopped' | 'error';

export interface UseMediaRecorderResult {
  state: RecorderState;
  start: () => Promise<void>;
  stop: () => Promise<Blob | null>;
  cancel: () => void;
  elapsedMs: number;
  level: number;            // 0-1 nivel de audio aproximado para indicador visual
  error: string | null;
}

interface Options {
  maxDurationMs?: number;
  mimeType?: string;
}

/**
 * Hook agnóstico para grabar audio en el navegador.
 * Auto-detect del mime type soportado. Tope opcional de duración.
 */
export function useMediaRecorder(options: Options = {}): UseMediaRecorderResult {
  const { maxDurationMs = 120_000 } = options;

  const [state, setState] = useState<RecorderState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startTsRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);

  // Audio level (analyser)
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelRafRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (levelRafRef.current) {
      cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    setLevel(0);
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  function pickMimeType(): string | undefined {
    if (typeof MediaRecorder === 'undefined') return undefined;
    if (options.mimeType && MediaRecorder.isTypeSupported(options.mimeType)) {
      return options.mimeType;
    }
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ];
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c)) return c;
    }
    return undefined;
  }

  const start = useCallback(async () => {
    setError(null);
    setElapsedMs(0);
    setLevel(0);
    setState('requesting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      // Audio level analyser
      try {
        const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
        const src = ac.createMediaStreamSource(stream);
        const analyser = ac.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);
        audioCtxRef.current = ac;
        analyserRef.current = analyser;

        const buf = new Uint8Array(analyser.frequencyBinCount);
        const tickLevel = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buf.length);
          setLevel(Math.min(1, rms * 3.5));
          levelRafRef.current = requestAnimationFrame(tickLevel);
        };
        tickLevel();
      } catch (e) {
        // Si el analyser falla, seguimos grabando sin indicador.
      }

      startTsRef.current = Date.now();
      recorder.start();
      setState('recording');

      tickRef.current = window.setInterval(() => {
        const e = Date.now() - startTsRef.current;
        setElapsedMs(e);
        if (e >= maxDurationMs && recorder.state === 'recording') {
          recorder.stop();
        }
      }, 100);
    } catch (e) {
      cleanup();
      setError(String(e));
      setState('error');
    }
  }, [cleanup, maxDurationMs, options.mimeType]);

  const stop = useCallback(async (): Promise<Blob | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'recording') {
      cleanup();
      setState('idle');
      return null;
    }

    return new Promise<Blob | null>((resolve) => {
      recorder.onstop = () => {
        const mime = recorder.mimeType || 'audio/webm';
        const blob =
          chunksRef.current.length > 0
            ? new Blob(chunksRef.current, { type: mime })
            : null;
        cleanup();
        setState('stopped');
        resolve(blob);
      };
      recorder.stop();
    });
  }, [cleanup]);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state === 'recording') {
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {}
    }
    cleanup();
    setState('idle');
    setElapsedMs(0);
  }, [cleanup]);

  return { state, start, stop, cancel, elapsedMs, level, error };
}
