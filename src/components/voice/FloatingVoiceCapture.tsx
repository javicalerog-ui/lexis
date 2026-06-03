'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import { VoiceRecorder } from '@/components/audio/VoiceRecorder';
import { fetchJson } from '@/lib/fetch-json';
import styles from './FloatingVoiceCapture.module.css';

/**
 * FAB de captura. Dos modos en el modal:
 *  1. Voz (default): graba → transcribe → ingest → success → auto-close.
 *  2. Captura de calendario: subes foto/screenshot del calendario →
 *     extractor de visión → /events/preview para revisar y crear.
 *
 * Oculto en /, /login, /oauth/*, /interview, /events/preview.
 */

const HIDDEN_PATHS = ['/', '/login'];
const HIDDEN_PREFIXES = ['/oauth/', '/interview', '/events/preview', '/inbox', '/settings/notifications', '/settings/proactive-rules'];

type Mode = 'voice' | 'calendar_image';
type Status = 'idle' | 'open' | 'ingesting' | 'success' | 'error';

export function FloatingVoiceCapture() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('voice');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Atajo 'C' — abre FAB en modo voz
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== 'c') return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || (t as any).isContentEditable)) {
        return;
      }
      e.preventDefault();
      setMode('voice');
      setOpen(true);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (status === 'success') {
      const t = setTimeout(() => {
        setOpen(false);
        setStatus('idle');
      }, 2500);
      return () => clearTimeout(t);
    }
  }, [status]);

  const isHidden =
    HIDDEN_PATHS.includes(pathname) ||
    HIDDEN_PREFIXES.some((p) => pathname.startsWith(p));
  if (isHidden) return null;

  async function ingestVoice(text: string) {
    if (!text.trim()) return;
    setStatus('ingesting');
    try {
      await fetchJson('/api/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_type: 'voice',
          raw_text: text,
          source_metadata: { origin: 'fab_voice' },
        }),
      });
      setStatus('success');
    } catch (e) {
      setErrorMsg(String(e));
      setStatus('error');
    }
  }

  async function uploadAndProcessCalendarImage(file: File) {
    setStatus('ingesting');
    setErrorMsg(null);
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No autenticado');

      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${user.id}/calendar-captures/${Date.now()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('lexis-raw')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw new Error(`upload: ${upErr.message}`);

      const { data: pub } = supabase.storage.from('lexis-raw').getPublicUrl(path);
      if (!pub?.publicUrl) throw new Error('no public url');

      // Redirige a la página de preview con la URL en query.
      // /events/preview se encargará de llamar a /api/events/from-image.
      const target = `/events/preview?image_url=${encodeURIComponent(pub.publicUrl)}`;
      setOpen(false);
      setStatus('idle');
      router.push(target);
    } catch (e) {
      setErrorMsg(String(e));
      setStatus('error');
    }
  }

  function reset() {
    setOpen(false);
    setStatus('idle');
    setErrorMsg(null);
    setMode('voice');
  }

  return (
    <>
      <button
        className={`${styles.fab} ${open ? styles.fabOpen : ''}`}
        onClick={() => setOpen(true)}
        aria-label="Captura rápida"
        title="Captura (tecla C)"
      >
        <span className={styles.fabGlyph}>◉</span>
      </button>

      {open && (
        <div className={styles.scrim} onClick={status === 'idle' ? reset : undefined}>
          <div className={styles.sheet} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <header className={styles.head}>
              <h2 className={styles.title}>
                {status === 'success' ? 'Capturado' : status === 'error' ? 'Error' : 'Captura rápida'}
              </h2>
              <button onClick={reset} className={styles.close} aria-label="Cerrar">×</button>
            </header>

            {status === 'success' ? (
              <div className={styles.successBody}>
                <span className={styles.checkGlyph}>✓</span>
                <p className={styles.successText}>
                  Memoria capturada y procesándose. Aparecerá en tu timeline en unos segundos.
                </p>
              </div>
            ) : status === 'error' ? (
              <div className={styles.errorBody}>
                <p className={styles.errorText}>{errorMsg}</p>
                <button onClick={() => { setStatus('idle'); setErrorMsg(null); }} className={styles.retryBtn}>
                  Reintentar
                </button>
              </div>
            ) : (
              <>
                {/* Selector de modo */}
                <div className={styles.modeTabs}>
                  <button
                    onClick={() => setMode('voice')}
                    className={`${styles.modeTab} ${mode === 'voice' ? styles.modeTabActive : ''}`}
                  >
                    <span>◉</span> Voz
                  </button>
                  <button
                    onClick={() => setMode('calendar_image')}
                    className={`${styles.modeTab} ${mode === 'calendar_image' ? styles.modeTabActive : ''}`}
                  >
                    <span>◷</span> Foto del calendario
                  </button>
                </div>

                {mode === 'voice' ? (
                  <div className={styles.recordWrap}>
                    <p className={styles.hint}>
                      Dicta lo que quieras recordar. Lexis lo transcribe, lo clasifica y lo añade al grafo. Si mencionas fechas, las extrae como eventos.
                    </p>
                    <VoiceRecorder
                      onTranscript={ingestVoice}
                      reviewBeforeSubmit={false}
                      disabled={status === 'ingesting'}
                    />
                    {status === 'ingesting' && (
                      <p className={styles.ingestingNote}>
                        <span className={styles.spinner}><span /><span /><span /></span>
                        Procesando memoria…
                      </p>
                    )}
                  </div>
                ) : (
                  <div className={styles.imageWrap}>
                    <p className={styles.hint}>
                      Sube una captura de tu Outlook, Google Calendar o cualquier vista de agenda. Lexis identificará los eventos y los podrás revisar antes de crearlos en Google Calendar.
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadAndProcessCalendarImage(f);
                      }}
                      className={styles.hiddenFile}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className={styles.uploadBtn}
                      disabled={status === 'ingesting'}
                    >
                      {status === 'ingesting' ? 'Subiendo…' : '📸 Elegir foto / sacar foto'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
