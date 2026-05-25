'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './DigestActions.module.css';

type Cadence = 'weekly' | 'biweekly' | 'monthly';

interface Prefs {
  user_id: string;
  enabled: boolean;
  cadence: Cadence;
  send_hour_utc: number;
  day_of_week: number | null;
  day_of_month: number | null;
  email: string | null;
  last_sent_at: string | null;
}

interface Props {
  initialPrefs: Prefs | null;
  userEmail: string | null;
}

const CADENCE_LABEL: Record<Cadence, string> = {
  weekly: 'Semanal',
  biweekly: 'Quincenal',
  monthly: 'Mensual',
};

const DOW_LABEL = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export function DigestActions({ initialPrefs, userEmail }: Props) {
  const router = useRouter();
  const [prefs, setPrefs] = useState<Prefs>(
    initialPrefs ?? {
      user_id: '',
      enabled: true,
      cadence: 'weekly',
      send_hour_utc: 7,
      day_of_week: 1,
      day_of_month: 1,
      email: userEmail,
      last_sent_at: null,
    }
  );
  const [editing, setEditing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function savePrefs(patch: Partial<Prefs>) {
    setError(null);
    try {
      const res = await fetch('/api/digest/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error);
      setPrefs((p) => ({ ...p, ...patch }));
    } catch (e) {
      setError(String(e));
    }
  }

  async function preview() {
    if (generating) return;
    setGenerating(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/digest/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cadence: prefs.cadence,
          dry_run: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error);
      router.push(`/digest/${data.digest_id}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function sendNow() {
    if (sending) return;
    if (!confirm(`¿Enviar el digest ahora a ${prefs.email || userEmail}?`)) return;
    setSending(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/digest/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cadence: prefs.cadence }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error);
      setSuccess(`Enviado a ${data.destination}`);
      setTimeout(() => router.push(`/digest/${data.digest_id}`), 800);
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className={styles.card}>
      <header className={styles.head}>
        <div className={styles.headLeft}>
          <span className={styles.glyph} aria-hidden>✉</span>
          <div>
            <h2 className={styles.title}>Resumen periódico</h2>
            <p className={styles.sub}>
              Síntesis editorial de lo que se ha movido, qué llevas parado y qué decidir.
            </p>
          </div>
        </div>
      </header>

      <div className={styles.settingsRow}>
        <div className={styles.settingChip}>
          <span className={styles.settingKey}>Cadencia</span>
          <select
            className={styles.select}
            value={prefs.cadence}
            onChange={(e) => savePrefs({ cadence: e.target.value as Cadence })}
          >
            {Object.entries(CADENCE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>

        {(prefs.cadence === 'weekly' || prefs.cadence === 'biweekly') && (
          <div className={styles.settingChip}>
            <span className={styles.settingKey}>Día</span>
            <select
              className={styles.select}
              value={prefs.day_of_week ?? 1}
              onChange={(e) => savePrefs({ day_of_week: parseInt(e.target.value) })}
            >
              {DOW_LABEL.map((d, i) => (
                <option key={i} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className={styles.settingChip}>
          <span className={styles.settingKey}>Hora UTC</span>
          <select
            className={styles.select}
            value={prefs.send_hour_utc}
            onChange={(e) => savePrefs({ send_hour_utc: parseInt(e.target.value) })}
          >
            {Array.from({ length: 24 }).map((_, i) => (
              <option key={i} value={i}>
                {String(i).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </div>

        <button
          className={styles.toggle}
          onClick={() => savePrefs({ enabled: !prefs.enabled })}
          title={prefs.enabled ? 'Desactivar envío automático' : 'Activar envío automático'}
        >
          <span
            className={`${styles.toggleDot} ${prefs.enabled ? styles.toggleOn : ''}`}
          />
          <span>{prefs.enabled ? 'Activo' : 'Pausado'}</span>
        </button>
      </div>

      <div className={styles.emailRow}>
        <span className={styles.emailLabel}>Destino:</span>
        {editing ? (
          <>
            <input
              className={styles.emailInput}
              type="email"
              value={prefs.email ?? userEmail ?? ''}
              onChange={(e) => setPrefs((p) => ({ ...p, email: e.target.value }))}
            />
            <button
              className={styles.smallBtn}
              onClick={() => {
                savePrefs({ email: prefs.email || null });
                setEditing(false);
              }}
            >
              Guardar
            </button>
          </>
        ) : (
          <>
            <code className={styles.emailValue}>
              {prefs.email || userEmail || '(sin email)'}
            </code>
            <button className={styles.smallBtn} onClick={() => setEditing(true)}>
              Cambiar
            </button>
          </>
        )}
      </div>

      {prefs.last_sent_at && (
        <p className={styles.lastSent}>
          Último envío:{' '}
          {new Date(prefs.last_sent_at).toLocaleString('es-ES', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      )}

      {error && (
        <p className={styles.error}>
          <strong>Error:</strong> {error}
        </p>
      )}
      {success && <p className={styles.success}>{success}</p>}

      <div className={styles.actions}>
        <button onClick={preview} disabled={generating} className={styles.btnGhost}>
          {generating ? (
            <span className={styles.spin}><span /><span /><span /></span>
          ) : (
            'Generar preview'
          )}
        </button>
        <button onClick={sendNow} disabled={sending} className={styles.btnPrimary}>
          {sending ? (
            <span className={styles.spin}><span /><span /><span /></span>
          ) : (
            'Enviar ahora'
          )}
        </button>
      </div>
    </section>
  );
}
