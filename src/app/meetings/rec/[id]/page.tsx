'use client';

// Detalle de un acta: pipeline, audio, brief editable y transcript.
// Port de app/src/screens/Detail.tsx de Acta (tablas acta_*, bucket acta-audio).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getSupabase } from '@/lib/acta/api';
import {
  BriefRow,
  fmtClock,
  fmtDate,
  RecordingRow,
  Segment,
  TemplateMeta,
} from '@/lib/acta/format';

const PROCESSING = ['uploaded', 'transcribing', 'extracting'];
const STAGES: Array<{ key: string; label: string }> = [
  { key: 'uploaded', label: 'En cola' },
  { key: 'transcribing', label: 'Transcribiendo' },
  { key: 'extracting', label: 'Extrayendo' },
  { key: 'review', label: 'Revisión' },
  { key: 'synced', label: 'En Lexis' },
];

export default function MeetingDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const [rec, setRec] = useState<RecordingRow | null>(null);
  const [brief, setBrief] = useState<BriefRow | null>(null);
  const [template, setTemplate] = useState<TemplateMeta | null>(null);
  const [transcript, setTranscript] = useState<{ text: string; segments: Segment[] } | null>(null);
  const [audioUrls, setAudioUrls] = useState<string[]>([]);
  const [payload, setPayload] = useState<Record<string, unknown>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<RecordingRow>(`/api/recordings/${id}`);
      setRec(r);
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [id]);

  const pollTimerRef = useRef(0);

  const resumePolling = useCallback(() => {
    window.clearTimeout(pollTimerRef.current);
    let alive = true;
    const tick = async () => {
      const r = await load();
      if (!alive || !r) return;
      const inFlight = PROCESSING.includes(r.status) || r.brief?.status === 'approved';
      if (inFlight) pollTimerRef.current = window.setTimeout(tick, 4000);
    };
    void tick();
    return () => {
      alive = false;
    };
  }, [load]);

  // Poll mientras procesa o mientras la entrega a Lexis está en vuelo
  useEffect(() => {
    const stop = resumePolling();
    return () => {
      stop();
      window.clearTimeout(pollTimerRef.current);
    };
  }, [resumePolling]);

  // Cargar brief + plantilla + transcript + audio cuando esté en revisión o después
  useEffect(() => {
    if (!rec || !['review', 'synced'].includes(rec.status)) return;
    if (!brief) {
      api<BriefRow>(`/api/recordings/${id}/brief`)
        .then((b) => {
          setBrief(b);
          setPayload(b.payload);
        })
        .catch(() => undefined);
      api<TemplateMeta[]>('/api/templates')
        .then((ts) => setTemplate(ts.find((t) => t.key === rec.template_key) ?? null))
        .catch(() => undefined);
      getSupabase()
        .from('acta_transcripts')
        .select('text,segments')
        .eq('recording_id', id)
        .maybeSingle()
        .then(({ data }) => {
          if (data) setTranscript(data as { text: string; segments: Segment[] });
        });
    }
    if (audioUrls.length === 0 && !rec.audio_purged_at) {
      const paths =
        rec.audio_sessions && rec.audio_sessions.length > 0
          ? rec.audio_sessions
          : rec.audio_path
            ? [rec.audio_path]
            : [];
      if (paths.length > 0) {
        Promise.all(paths.map((p) => getSupabase().storage.from('acta-audio').createSignedUrl(p, 600))).then(
          (results) => {
            const urls = results
              .map((r) => r.data?.signedUrl)
              .filter((u): u is string => Boolean(u));
            if (urls.length > 0) setAudioUrls(urls);
          }
        );
      }
    }
  }, [rec, brief, audioUrls, id]);

  if (error && !rec) {
    return (
      <section className="card">
        <p className="hint">No se pudo cargar: {error}</p>
      </section>
    );
  }
  if (!rec) return <section className="card">Cargando…</section>;

  const stageIdx = STAGES.findIndex((s) => s.key === rec.status);

  async function save(): Promise<boolean> {
    if (!brief) return false;
    setBusy('save');
    setError(null);
    try {
      const updated = await api<BriefRow>(`/api/briefs/${brief.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ payload }),
      });
      setBrief(updated);
      setPayload(updated.payload);
      setDirty(false);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    if (!brief) return;
    // Si el guardado previo falla (microcorte de red), NO aprobar: de lo
    // contrario se entregaría a Lexis la versión SIN las ediciones del usuario.
    if (dirty) {
      const ok = await save();
      if (!ok) return;
    }
    setBusy('approve');
    setError(null);
    try {
      await api(`/api/briefs/${brief.id}/approve`, { method: 'POST' });
      setBrief({ ...brief, status: 'approved' });
      // Reanudar el polling: la entrega a Lexis es un Workflow asíncrono; sin
      // esto la vista se queda colgada en 'Entregando a Lexis…' para siempre.
      resumePolling();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function retryRecording() {
    setBusy('retry-recording');
    setError(null);
    try {
      await api(`/api/recordings/${id}/retry`, { method: 'POST' });
      resumePolling();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function retryDelivery() {
    if (!brief) return;
    setBusy('retry-delivery');
    setError(null);
    try {
      await api(`/api/briefs/${brief.id}/retry-delivery`, { method: 'POST' });
      setBrief({ ...brief, status: 'approved' });
      resumePolling();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function downloadMd() {
    if (!brief) return;
    const blob = new Blob([brief.summary_md], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `acta-${(rec!.title || rec!.template_key).replace(/\s+/g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function seek(t: number) {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = t;
    void el.play().catch(() => undefined);
  }

  const briefState =
    brief?.status === 'synced'
      ? 'Entregada a Lexis'
      : brief?.status === 'approved'
        ? 'Entregando a Lexis…'
        : brief?.status === 'failed'
          ? 'Entrega a Lexis fallida'
          : 'Borrador — revisa y aprueba';

  return (
    <>
      <section className="card">
        <button className="btn-ghost" onClick={() => router.push('/meetings')}>
          ← Actas
        </button>
        <h2 style={{ marginTop: 8 }}>{rec.title || 'Sin título'}</h2>
        <p className="meta">
          {fmtDate(rec.started_at)} · {rec.template_key.replace(/_/g, ' ')}
          {rec.duration_s ? ` · ${fmtClock(rec.duration_s)}` : ''}
        </p>

        {rec.status === 'failed' ? (
          <div>
            <p className="hint">
              Falló el procesado: {rec.error || 'error desconocido'}. Puedes reintentar sin
              volver a grabar (el audio ya está subido).
            </p>
            <button
              className="primary"
              style={{ marginTop: 8 }}
              onClick={retryRecording}
              disabled={busy !== null}
            >
              {busy === 'retry-recording' ? 'Reintentando…' : 'Reintentar procesado'}
            </button>
          </div>
        ) : (
          <ol className="stages">
            {STAGES.map((s, i) => (
              <li
                key={s.key}
                className={i < stageIdx ? 'done' : i === stageIdx ? 'active' : ''}
              >
                {s.label}
              </li>
            ))}
          </ol>
        )}
      </section>

      {audioUrls.length > 0 && (
        <section className="card">
          <h2>Audio{audioUrls.length > 1 ? ` · ${audioUrls.length} tramos` : ''}</h2>
          {audioUrls.map((url, i) => (
            <div key={i} style={{ marginTop: i > 0 ? 10 : 0 }}>
              {audioUrls.length > 1 && <p className="meta">Tramo {i + 1}</p>}
              <audio
                ref={i === 0 ? audioRef : undefined}
                controls
                src={url}
                style={{ width: '100%' }}
              />
            </div>
          ))}
          {audioUrls.length > 1 && (
            <p className="hint">
              Reunión larga grabada en tramos de ~20&nbsp;min; los saltos desde el
              transcript apuntan al primer tramo.
            </p>
          )}
        </section>
      )}
      {rec.audio_purged_at && (
        <p className="hint" style={{ paddingLeft: 4 }}>
          Audio purgado por retención; transcript y brief se conservan.
        </p>
      )}

      {brief && template && (
        <section className="card">
          <h2>Brief · {briefState}</h2>
          {brief.confidence != null && (
            <p className="meta">
              confianza {(brief.confidence * 100).toFixed(0)}% · {brief.model_used}
            </p>
          )}
          <BriefEditor
            template={template}
            payload={payload}
            editable={brief.status === 'draft'}
            onChange={(p) => {
              setPayload(p);
              setDirty(true);
            }}
          />
          <div className="row-actions" style={{ marginTop: 14 }}>
            {brief.status === 'draft' && (
              <>
                <button className="btn-secondary" onClick={save} disabled={!dirty || busy !== null}>
                  {busy === 'save' ? 'Guardando…' : 'Guardar'}
                </button>
                <button
                  className="primary"
                  style={{ marginTop: 0 }}
                  onClick={approve}
                  disabled={busy !== null}
                >
                  {busy === 'approve' ? 'Enviando…' : 'Aprobar y enviar a Lexis'}
                </button>
              </>
            )}
            {brief.status === 'failed' && (
              <button
                className="primary"
                style={{ marginTop: 0 }}
                onClick={retryDelivery}
                disabled={busy !== null}
              >
                {busy === 'retry-delivery' ? 'Reintentando…' : 'Reintentar entrega a Lexis'}
              </button>
            )}
            <button className="btn-secondary" onClick={downloadMd}>
              Descargar .md
            </button>
          </div>
          {error && <p className="hint">Error: {error}</p>}
        </section>
      )}

      {transcript && (
        <section className="card">
          <h2>
            Transcript{' '}
            <button className="btn-ghost" onClick={() => setShowTranscript((v) => !v)}>
              {showTranscript ? 'ocultar' : 'mostrar'}
            </button>
          </h2>
          {showTranscript &&
            (transcript.segments.length > 0 ? (
              <div className="segments">
                {transcript.segments.map((s, i) => (
                  <button key={i} className="seg" onClick={() => seek(s.start)}>
                    <span className="seg-t">{fmtClock(s.start)}</span>
                    <span>{s.text}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{transcript.text}</p>
            ))}
        </section>
      )}
    </>
  );
}

// =====================================================
// Editor de brief por tipo de sección
// =====================================================

interface EditorProps {
  template: TemplateMeta;
  payload: Record<string, unknown>;
  editable: boolean;
  onChange: (p: Record<string, unknown>) => void;
}

type ActionItem = { texto: string; owner: string; deadline_texto: string };
type Entity = { nombre: string; tipo: string };

function BriefEditor({ template, payload, editable, onChange }: EditorProps) {
  function set(key: string, value: unknown) {
    onChange({ ...payload, [key]: value });
  }

  return (
    <div className="editor">
      {template.sections.map((sec) => {
        const v = payload[sec.key];
        return (
          <div key={sec.key} className="editor-sec">
            <label>{sec.label}</label>

            {sec.type === 'text' && (
              <textarea
                rows={3}
                disabled={!editable}
                value={typeof v === 'string' && v !== 'PENDING' ? v : ''}
                placeholder={v === 'PENDING' ? 'PENDING (no aparece en la reunión)' : ''}
                onChange={(e) => set(sec.key, e.target.value)}
              />
            )}

            {sec.type === 'list' && (
              <textarea
                rows={3}
                disabled={!editable}
                value={Array.isArray(v) ? (v as string[]).join('\n') : ''}
                placeholder="Una entrada por línea"
                onChange={(e) =>
                  set(
                    sec.key,
                    e.target.value.split('\n').map((l) => l.trim()).filter(Boolean)
                  )
                }
              />
            )}

            {sec.type === 'action_items' && (
              <ActionItemsEditor
                items={Array.isArray(v) ? (v as ActionItem[]) : []}
                editable={editable}
                onChange={(items) => set(sec.key, items)}
              />
            )}

            {sec.type === 'entities' && (
              <EntitiesEditor
                items={Array.isArray(v) ? (v as Entity[]) : []}
                editable={editable}
                onChange={(items) => set(sec.key, items)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ActionItemsEditor({
  items,
  editable,
  onChange,
}: {
  items: ActionItem[];
  editable: boolean;
  onChange: (i: ActionItem[]) => void;
}) {
  function upd(i: number, field: keyof ActionItem, value: string) {
    const next = items.map((it, j) => (j === i ? { ...it, [field]: value } : it));
    onChange(next);
  }
  return (
    <div className="ai-list">
      {items.map((it, i) => (
        <div key={i} className="ai-row">
          <input
            disabled={!editable}
            value={it.texto ?? ''}
            placeholder="Compromiso"
            onChange={(e) => upd(i, 'texto', e.target.value)}
          />
          <input
            disabled={!editable}
            value={it.owner ?? ''}
            placeholder="Responsable"
            onChange={(e) => upd(i, 'owner', e.target.value)}
          />
          <input
            disabled={!editable}
            value={it.deadline_texto ?? ''}
            placeholder="Plazo"
            onChange={(e) => upd(i, 'deadline_texto', e.target.value)}
          />
          {editable && (
            <button className="btn-ghost" onClick={() => onChange(items.filter((_, j) => j !== i))}>
              ✕
            </button>
          )}
        </div>
      ))}
      {editable && (
        <button
          className="btn-secondary"
          onClick={() => onChange([...items, { texto: '', owner: '', deadline_texto: '' }])}
        >
          + Añadir compromiso
        </button>
      )}
    </div>
  );
}

function EntitiesEditor({
  items,
  editable,
  onChange,
}: {
  items: Entity[];
  editable: boolean;
  onChange: (i: Entity[]) => void;
}) {
  function upd(i: number, field: keyof Entity, value: string) {
    onChange(items.map((it, j) => (j === i ? { ...it, [field]: value } : it)));
  }
  return (
    <div className="ai-list">
      {items.map((it, i) => (
        <div key={i} className="ai-row two">
          <input
            disabled={!editable}
            value={it.nombre ?? ''}
            placeholder="Nombre"
            onChange={(e) => upd(i, 'nombre', e.target.value)}
          />
          <input
            disabled={!editable}
            value={it.tipo ?? ''}
            placeholder="Tipo (persona, empresa…)"
            onChange={(e) => upd(i, 'tipo', e.target.value)}
          />
          {editable && (
            <button className="btn-ghost" onClick={() => onChange(items.filter((_, j) => j !== i))}>
              ✕
            </button>
          )}
        </div>
      ))}
      {editable && (
        <button className="btn-secondary" onClick={() => onChange([...items, { nombre: '', tipo: '' }])}>
          + Añadir
        </button>
      )}
    </div>
  );
}
