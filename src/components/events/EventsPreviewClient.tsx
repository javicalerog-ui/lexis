'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { fetchJson } from '@/lib/fetch-json';
import styles from './EventsPreviewClient.module.css';

interface EventDraft {
  title: string;
  due_at_utc: string;
  ends_at_utc: string | null;
  all_day: boolean;
  location: string | null;
  attendees: string[];
  description: string | null;
  confidence: number;
  source_local_date: string;
  source_local_time: string | null;
}

interface EditableDraft extends EventDraft {
  selected: boolean;
  type: 'meeting' | 'deadline' | 'follow_up' | 'reminder' | 'recurring';
  _id: string;                  // id local
}

const TYPE_OPTIONS = [
  { v: 'meeting', l: 'Reunión' },
  { v: 'deadline', l: 'Deadline' },
  { v: 'follow_up', l: 'Follow-up' },
  { v: 'reminder', l: 'Recordatorio' },
  { v: 'recurring', l: 'Recurrente' },
];

export function EventsPreviewClient() {
  const params = useSearchParams();
  const router = useRouter();
  const imageUrl = params.get('image_url');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timezone, setTimezone] = useState<string>('Europe/Madrid');
  const [drafts, setDrafts] = useState<EditableDraft[]>([]);
  const [createInCalendar, setCreateInCalendar] = useState(true);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<{ count: number; errors: number } | null>(null);

  // Cargar extracción al montar
  useEffect(() => {
    if (!imageUrl) {
      setError('Falta image_url en la query.');
      setLoading(false);
      return;
    }
    fetchJson('/api/events/from-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: imageUrl }),
    })
      .then((data) => {
        if (!data.is_calendar_view) {
          setError(data.message || 'La imagen no parece una vista de calendario.');
          return;
        }
        setTimezone(data.timezone || 'Europe/Madrid');
        setDrafts(
          (data.events as EventDraft[]).map((e, idx) => ({
            ...e,
            selected: e.confidence >= 0.7,
            type: inferType(e),
            _id: `d_${idx}`,
          }))
        );
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [imageUrl]);

  function inferType(e: EventDraft): EditableDraft['type'] {
    if (e.attendees && e.attendees.length > 0) return 'meeting';
    if (e.all_day) return 'reminder';
    return 'meeting';
  }

  function updateDraft(id: string, patch: Partial<EditableDraft>) {
    setDrafts((prev) => prev.map((d) => (d._id === id ? { ...d, ...patch } : d)));
  }

  function toggleAll(value: boolean) {
    setDrafts((prev) => prev.map((d) => ({ ...d, selected: value })));
  }

  async function createSelected() {
    const selected = drafts.filter((d) => d.selected);
    if (selected.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const data = await fetchJson('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          create_in_calendar: createInCalendar,
          source: 'image',
          events: selected.map((d) => ({
            title: d.title,
            due_at: d.due_at_utc,
            ends_at: d.ends_at_utc,
            all_day: d.all_day,
            type: d.type,
            description: d.description,
            location: d.location,
            attendees: d.attendees,
          })),
        }),
      });
      setResult({ count: data.inserted_count, errors: data.error_count });
      setTimeout(() => router.push('/feed'), 2000);
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  }

  function fmtLocal(d: EditableDraft): string {
    const dt = new Intl.DateTimeFormat('es-ES', {
      timeZone: timezone,
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: d.all_day ? undefined : '2-digit',
      minute: d.all_day ? undefined : '2-digit',
      hourCycle: 'h23',
    }).format(new Date(d.due_at_utc));
    return d.all_day ? `${dt} · todo el día` : dt;
  }

  if (loading) {
    return (
      <div className={styles.loading}>
        <span className={styles.spinner}><span /><span /><span /></span>
        <p>Analizando la imagen…</p>
        {imageUrl && (
          <img src={imageUrl} alt="captura calendario" className={styles.preview} />
        )}
      </div>
    );
  }

  if (result) {
    return (
      <div className={styles.successWrap}>
        <span className={styles.checkBig}>✓</span>
        <h2 className={styles.successTitle}>
          {result.count} evento{result.count !== 1 ? 's' : ''} creados
          {createInCalendar && ' también en Google Calendar'}
        </h2>
        {result.errors > 0 && (
          <p className={styles.warn}>
            {result.errors} con error (revisa la consola del navegador).
          </p>
        )}
        <p className={styles.successHint}>Te redirijo al feed…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.errorWrap}>
        <p className={styles.errorText}>{error}</p>
        <button onClick={() => router.push('/')} className={styles.btn}>Volver al inicio</button>
      </div>
    );
  }

  const selectedCount = drafts.filter((d) => d.selected).length;

  return (
    <section>
      <div className={styles.intro}>
        <p>
          He detectado <strong>{drafts.length} evento{drafts.length !== 1 ? 's' : ''}</strong> en la imagen. Revisa, edita lo que haga falta y confirma los que quieras crear.
        </p>
        <div className={styles.bulkActions}>
          <button onClick={() => toggleAll(true)} className={styles.linkBtn}>Seleccionar todos</button>
          <span className={styles.sep}>·</span>
          <button onClick={() => toggleAll(false)} className={styles.linkBtn}>Ninguno</button>
        </div>
      </div>

      <ul className={styles.list}>
        {drafts.map((d) => (
          <li key={d._id} className={`${styles.card} ${d.selected ? styles.cardSelected : ''}`}>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={d.selected}
                onChange={(e) => updateDraft(d._id, { selected: e.target.checked })}
                className={styles.checkbox}
              />
              <input
                type="text"
                value={d.title}
                onChange={(e) => updateDraft(d._id, { title: e.target.value })}
                className={styles.titleInput}
                placeholder="Título"
              />
              <span className={styles.confTag}>
                {(d.confidence * 100).toFixed(0)}%
              </span>
            </label>

            <div className={styles.row}>
              <span className={styles.label}>Cuándo</span>
              <span className={styles.value}>{fmtLocal(d)}</span>
            </div>

            <div className={styles.row}>
              <span className={styles.label}>Tipo</span>
              <select
                value={d.type}
                onChange={(e) => updateDraft(d._id, { type: e.target.value as EditableDraft['type'] })}
                className={styles.select}
              >
                {TYPE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </div>

            {d.location && (
              <div className={styles.row}>
                <span className={styles.label}>Lugar</span>
                <span className={styles.value}>{d.location}</span>
              </div>
            )}
            {d.attendees && d.attendees.length > 0 && (
              <div className={styles.row}>
                <span className={styles.label}>Con</span>
                <span className={styles.value}>{d.attendees.join(', ')}</span>
              </div>
            )}
            {d.description && (
              <div className={styles.descBox}>{d.description}</div>
            )}
          </li>
        ))}
      </ul>

      <div className={styles.toolbar}>
        <label className={styles.toggleField}>
          <input
            type="checkbox"
            checked={createInCalendar}
            onChange={(e) => setCreateInCalendar(e.target.checked)}
            className={styles.hidden}
          />
          <span className={`${styles.switch} ${createInCalendar ? styles.switchOn : ''}`}>
            <span className={styles.switchKnob} />
          </span>
          <span>
            <strong>Crear también en Google Calendar</strong>
            <span className={styles.toggleDesc}>
              Va al calendario «Lexis · Borradores» salvo que tengas activo «write to primary».
            </span>
          </span>
        </label>

        <button
          onClick={createSelected}
          disabled={selectedCount === 0 || creating}
          className={styles.createBtn}
        >
          {creating ? 'Creando…' : `Crear ${selectedCount} evento${selectedCount !== 1 ? 's' : ''}`}
        </button>
      </div>
    </section>
  );
}
