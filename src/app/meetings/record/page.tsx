'use client';

// Pantalla de grabación. Port de app/src/screens/Record.tsx de Acta.
// Cambios del port: userId sale de la sesión de Lexis; pickMime() se evalúa
// en un effect (no durante el render) para no romper el prerender/hidratación.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getSupabase } from '@/lib/acta/api';
import { ActaRecorder, pickMime, type MimeInfo } from '@/lib/acta/recorder';
import { fmtClock, TemplateMeta } from '@/lib/acta/format';

type Phase = 'setup' | 'starting' | 'rec' | 'paused' | 'finishing' | 'finish-failed';

export default function RecordPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [mimeInfo, setMimeInfo] = useState<MimeInfo | null | undefined>(undefined);
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [templateKey, setTemplateKey] = useState('reunion_interna');
  const [language, setLanguage] = useState('es');
  const [title, setTitle] = useState('');
  const [phase, setPhase] = useState<Phase>('setup');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [hiddenWarn, setHiddenWarn] = useState(false);
  const recRef = useRef<ActaRecorder | null>(null);
  const recordingIdRef = useRef<string | null>(null);

  useEffect(() => {
    setMimeInfo(pickMime());
    void getSupabase()
      .auth.getSession()
      .then(({ data }) => setUserId(data.session?.user.id ?? null));
    api<TemplateMeta[]>('/api/templates').then(setTemplates).catch(() => undefined);
    api<{ default_template: string; default_language: string }>('/api/settings')
      .then((s) => {
        setTemplateKey(s.default_template);
        setLanguage(s.default_language);
      })
      .catch(() => undefined);
    return () => {
      // Salir de la pantalla sin finalizar: soltar micro; el audio queda en
      // IndexedDB y la lista ofrecerá reanudar la subida.
      recRef.current?.abandon();
    };
  }, []);

  async function start() {
    if (!mimeInfo || !userId) return;
    setError(null);
    setPhase('starting');
    try {
      const created = await api<{ id: string }>('/api/recordings', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim() || null,
          template_key: templateKey,
          language,
          mime_type: mimeInfo.mime,
        }),
      });
      recordingIdRef.current = created.id;
      const rec = new ActaRecorder(created.id, userId, mimeInfo, title.trim() || null, {
        onElapsed: setElapsed,
        onLevel: setLevel,
        onPending: setPending,
        onError: (m) => setError(m),
        onScreenHidden: () => setHiddenWarn(true),
      });
      recRef.current = rec;
      await rec.start();
      setPhase('rec');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('setup');
    }
  }

  function togglePause() {
    const r = recRef.current;
    if (!r) return;
    if (phase === 'rec') {
      r.pause();
      setPhase('paused');
    } else if (phase === 'paused') {
      r.resume();
      setPhase('rec');
    }
  }

  async function finish() {
    const r = recRef.current;
    if (!r) return;
    setPhase('finishing');
    try {
      const { chunks, durationS } = await r.stop();
      const recordingId = recordingIdRef.current!;
      await api(`/api/recordings/${recordingId}/finalize`, {
        method: 'POST',
        body: JSON.stringify({ duration_s: durationS, chunk_count: chunks }),
      });
      await r.confirmDone(); // solo ahora se borra el rastro en IndexedDB
      recRef.current = null;
      router.push(`/meetings/rec/${recordingId}`);
    } catch (e) {
      // r.stop() es idempotente: si el fallo fue en el finalize (red), un
      // segundo tap en "Terminar" no vuelve a tocar el MediaRecorder, solo
      // reintenta el POST. Si el usuario sale de esta pantalla en vez de
      // reintentar, el audio ya subido queda recuperable desde el banner de
      // la lista ("Grabación interrumpida"), porque confirmDone() no se llamó.
      setError(e instanceof Error ? e.message : String(e));
      setPhase('finish-failed');
    }
  }

  if (mimeInfo === undefined) return null; // montando en cliente

  if (!mimeInfo) {
    return (
      <section className="card">
        <h2>Grabar</h2>
        <p className="hint">
          Este navegador no soporta MediaRecorder de audio. En iPhone usa Safari
          actualizado (iOS 16.4+) con Lexis añadida a la pantalla de inicio.
        </p>
      </section>
    );
  }

  if (phase === 'setup' || phase === 'starting') {
    return (
      <section className="card">
        <h2>Nueva acta</h2>
        <label htmlFor="tpl">Plantilla</label>
        <select id="tpl" value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
          {(templates.length ? templates : [{ key: templateKey, name: 'Reunión interna', sections: [] }]).map(
            (t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            )
          )}
        </select>
        <label htmlFor="title" style={{ marginTop: 12 }}>
          Título (opcional)
        </label>
        <input
          id="title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Weekly IBD, visita asociado…"
          maxLength={200}
        />
        <label htmlFor="lang" style={{ marginTop: 12 }}>
          Idioma
        </label>
        <select id="lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
          <option value="es">Español</option>
          <option value="en">English</option>
          <option value="auto">Detección automática</option>
        </select>
        <button className="primary" onClick={start} disabled={phase === 'starting' || !userId}>
          {phase === 'starting' ? 'Pidiendo micrófono…' : 'Empezar a grabar'}
        </button>
        {error && <p className="hint">Error: {error}</p>}
        <p className="hint">
          Mantén la pantalla encendida durante la grabación (en iPhone, el bloqueo
          de pantalla la pausa). El audio se sube en trozos mientras grabas y las
          reuniones largas se dividen solas en tramos de ~20&nbsp;min, así que no
          hay límite práctico de duración.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="card seal-wrap">
        <button
          className={`seal ${phase === 'rec' ? 'recording' : ''}`}
          onClick={togglePause}
          disabled={phase === 'finishing' || phase === 'finish-failed'}
          aria-label={phase === 'rec' ? 'Pausar' : 'Reanudar'}
        >
          {phase === 'rec' ? 'REC' : phase === 'paused' ? 'PAUSA' : '…'}
        </button>
        <div className="timer" aria-live="polite">
          {fmtClock(elapsed)}
        </div>
        <div className="levelbar" aria-hidden="true">
          <div className="levelbar-fill" style={{ width: `${Math.round(level * 100)}%` }} />
        </div>
        <p className="seal-note">
          {phase === 'finish-failed'
            ? '☁ audio subido, falta cerrar el acta'
            : pending > 0
              ? `☁ ${pending} trozo${pending === 1 ? '' : 's'} pendiente de subir`
              : '☁ sincronizado'}
          {phase === 'paused' ? ' · en pausa' : ''}
        </p>
        {hiddenWarn && phase !== 'finishing' && phase !== 'finish-failed' && (
          <p className="hint">
            La app pasó a segundo plano: en iPhone eso puede pausar el micro.
            Comprueba el cronómetro al volver.
          </p>
        )}
        {phase === 'finish-failed' && (
          <p className="hint">
            El audio ya se subió, pero no se pudo cerrar el acta (revisa la conexión).
            Puedes reintentar aquí sin perder nada, o volver a Reuniones: la grabación
            queda recuperable en &quot;Grabación interrumpida&quot;.
          </p>
        )}
        {error && <p className="hint">Aviso: {error}</p>}
      </section>

      <div className="row-actions">
        {phase !== 'finish-failed' && (
          <button className="btn-secondary" onClick={togglePause} disabled={phase === 'finishing'}>
            {phase === 'rec' ? 'Pausar' : 'Reanudar'}
          </button>
        )}
        <button
          className="primary"
          style={{ marginTop: 0 }}
          onClick={finish}
          disabled={phase === 'finishing'}
        >
          {phase === 'finishing'
            ? 'Subiendo y cerrando…'
            : phase === 'finish-failed'
              ? 'Reintentar cierre'
              : 'Terminar acta'}
        </button>
      </div>
    </>
  );
}
