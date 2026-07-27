'use client';

// Lista de actas + reanudación de subidas interrumpidas.
// Port de app/src/screens/Home.tsx de Acta (hash-router → App Router).

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/acta/api';
import { ActiveMeta, clearMeta, countChunks, getMeta, listChunks, deleteChunk } from '@/lib/acta/idb';
import { ChunkUploader } from '@/lib/acta/recorder';
import { fmtDate, RecordingRow, STATUS_ES } from '@/lib/acta/format';

export default function MeetingsPage() {
  const router = useRouter();
  const [recordings, setRecordings] = useState<RecordingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingMeta, setPendingMeta] = useState<ActiveMeta | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [resuming, setResuming] = useState(false);

  const refresh = useCallback(() => {
    api<RecordingRow[]>('/api/recordings')
      .then(setRecordings)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    refresh();
    void getMeta().then(async (m) => {
      if (!m) return;
      setPendingMeta(m);
      setPendingCount(await countChunks(m.recordingId));
    });
  }, [refresh]);

  async function resumeUpload() {
    if (!pendingMeta) return;
    setResuming(true);
    setError(null);
    try {
      const uploader = new ChunkUploader(
        pendingMeta.recordingId,
        pendingMeta.userId,
        setPendingCount,
        (m) => setError(m)
      );
      await uploader.drain();
      await api(`/api/recordings/${pendingMeta.recordingId}/finalize`, {
        method: 'POST',
        body: JSON.stringify({ duration_s: null, chunk_count: pendingMeta.seq }),
      });
      await clearMeta();
      const rid = pendingMeta.recordingId;
      setPendingMeta(null);
      router.push(`/meetings/rec/${rid}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResuming(false);
    }
  }

  async function discardPending() {
    if (!pendingMeta) return;
    const chunks = await listChunks(pendingMeta.recordingId);
    for (const c of chunks) await deleteChunk(c.key);
    await clearMeta();
    setPendingMeta(null);
  }

  return (
    <>
      {pendingMeta && (
        <section className="card banner">
          <h2>Grabación interrumpida</h2>
          <p className="meta">
            {pendingMeta.title || 'Sin título'} · {pendingCount} trozo
            {pendingCount === 1 ? '' : 's'} sin subir en este móvil.
          </p>
          <div className="row-actions" style={{ marginTop: 10 }}>
            <button className="primary" style={{ marginTop: 0 }} onClick={resumeUpload} disabled={resuming}>
              {resuming ? 'Subiendo…' : 'Reanudar subida y procesar'}
            </button>
            <button className="btn-secondary" onClick={discardPending} disabled={resuming}>
              Descartar
            </button>
          </div>
        </section>
      )}

      <section className="seal-wrap card">
        <button className="seal" onClick={() => router.push('/meetings/record')} aria-label="Grabar nueva acta">
          GRABAR
        </button>
        <p className="seal-note">Toca el sello para empezar una nueva acta.</p>
      </section>

      <section className="card">
        <h2>Actas</h2>
        {error && <p className="hint">Aviso: {error}</p>}
        {recordings && recordings.length === 0 && (
          <p className="empty">Aún no hay actas. La primera está a un sello de distancia.</p>
        )}
        {recordings && recordings.length > 0 && (
          <ul className="rec-list">
            {recordings.map((r) => (
              <li key={r.id}>
                <button className="rec-item" onClick={() => router.push(`/meetings/rec/${r.id}`)}>
                  <div>
                    <div className="title">{r.title ?? 'Sin título'}</div>
                    <div className="meta">
                      {fmtDate(r.started_at)}
                      {' · '}
                      {r.template_key.replace(/_/g, ' ')}
                      {r.duration_s ? ` · ${Math.round(r.duration_s / 60)} min` : ''}
                    </div>
                  </div>
                  <span className={`status ${r.status}`}>{STATUS_ES[r.status] ?? r.status}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
