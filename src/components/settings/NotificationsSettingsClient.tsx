'use client';

import { useEffect, useState } from 'react';
import { fetchJson } from '@/lib/fetch-json';
import styles from './NotificationsSettingsClient.module.css';

interface UserSettings {
  user_id: string;
  timezone: string;
  preferred_language: string;
  quiet_hours_start: string;
  quiet_hours_end: string;
  quiet_hours_enabled: boolean;
  push_enabled: boolean;
  push_types_enabled: Record<string, boolean>;
  push_offsets_minutes: number[];
}

interface PushSub {
  id: string;
  endpoint: string;
  user_agent: string | null;
  label: string | null;
  last_used_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  created_at: string;
}

const TYPE_LABELS: Record<string, { label: string; desc: string }> = {
  deadlines: {
    label: 'Deadlines',
    desc: 'Fechas límite extraídas de tus capturas y de Calendar.',
  },
  meetings: {
    label: 'Reuniones',
    desc: 'Aviso antes de meetings (X, Y, Z minutos antes según offsets).',
  },
  follow_ups: {
    label: 'Follow-ups',
    desc: 'Compromisos que has dictado ("envío X a Y antes del Z").',
  },
  reminders: {
    label: 'Recordatorios',
    desc: 'Recordatorios neutros sin compromiso específico.',
  },
  reviews: {
    label: 'Revisiones',
    desc: 'Reglas proactivas: repaso de viernes, captura semanal Outlook, proyectos durmiendo.',
  },
};

const OFFSET_OPTIONS = [
  { v: 15, l: '15 min antes' },
  { v: 60, l: '1 h antes' },
  { v: 240, l: '4 h antes' },
  { v: 1440, l: '24 h antes' },
  { v: 2880, l: '48 h antes' },
];

// ---------- VAPID helpers ----------

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  // Respaldamos en un ArrayBuffer explícito para que el tipo sea
  // Uint8Array<ArrayBuffer> (no ArrayBufferLike), asignable a BufferSource.
  const buffer = new ArrayBuffer(rawData.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) out[i] = rawData.charCodeAt(i);
  return out;
}

// ---------- Component ----------

export function NotificationsSettingsClient({
  initialSettings,
  vapidPublicKey,
}: {
  initialSettings: UserSettings;
  vapidPublicKey: string | null;
}) {
  const [settings, setSettings] = useState<UserSettings>(initialSettings);
  const [subs, setSubs] = useState<PushSub[]>([]);
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission>('default');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if ('Notification' in window) {
      setBrowserPermission(Notification.permission);
    }
    refreshSubs();
  }, []);

  async function refreshSubs() {
    try {
      const res = await fetch('/api/push/subscribe');
      if (res.ok) {
        const data = await res.json();
        setSubs(data.subscriptions || []);
      }
    } catch {}
  }

  async function patchSettings(patch: Partial<UserSettings>) {
    setBusy(true); setError(null); setMsg(null);
    try {
      const data = await fetchJson('/api/user-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      setSettings(data.settings);
      setMsg('Guardado');
      setTimeout(() => setMsg(null), 1800);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function enableOnThisDevice() {
    setError(null);
    if (!vapidPublicKey) {
      setError('Falta VAPID_PUBLIC_KEY en el servidor. Sigue las instrucciones en ONBOARDING.md.');
      return;
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setError('Tu navegador no soporta push notifications.');
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      setBrowserPermission(permission);
      if (permission !== 'granted') {
        setError('Has denegado los permisos. Cámbialo en los ajustes del navegador.');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      });
      const subJson = sub.toJSON();
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: subJson.endpoint!,
          keys: subJson.keys!,
          user_agent: navigator.userAgent.slice(0, 240),
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail || d.error);
      }
      await refreshSubs();
      setMsg('Dispositivo conectado');
      setTimeout(() => setMsg(null), 2400);
    } catch (e) {
      setError(String(e));
    }
  }

  async function removeSub(endpoint: string) {
    if (!confirm('¿Eliminar este dispositivo de las notificaciones?')) return;
    try {
      // Tratar de desuscribir el browser si es éste
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        if (sub && sub.endpoint === endpoint) {
          await sub.unsubscribe();
        }
      }
      await fetch('/api/push/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      });
      await refreshSubs();
    } catch (e) {
      setError(String(e));
    }
  }

  function toggleType(key: string, value: boolean) {
    patchSettings({
      push_types_enabled: { ...settings.push_types_enabled, [key]: value },
    });
  }

  function toggleOffset(min: number) {
    const cur = new Set(settings.push_offsets_minutes);
    if (cur.has(min)) cur.delete(min);
    else cur.add(min);
    patchSettings({ push_offsets_minutes: Array.from(cur).sort((a, b) => a - b) });
  }

  return (
    <div>
      {error && <div className={styles.error}>{error}</div>}
      {msg && <div className={styles.toast}>{msg}</div>}

      {/* ---------- Bloque general ---------- */}
      <section className={styles.section}>
        <h2 className={styles.h}>General</h2>
        <ToggleField
          checked={settings.push_enabled}
          onChange={(v) => patchSettings({ push_enabled: v })}
          label="Push notifications activas"
          desc="Si lo desactivas, Lexis no enviará ningún push aunque haya reglas configuradas."
        />
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Timezone</span>
          <select
            className={styles.input}
            value={settings.timezone}
            onChange={(e) => patchSettings({ timezone: e.target.value })}
            disabled={busy}
          >
            <option>Europe/Madrid</option>
            <option>Europe/London</option>
            <option>Europe/Berlin</option>
            <option>Europe/Lisbon</option>
            <option>America/New_York</option>
            <option>America/Los_Angeles</option>
            <option>Asia/Tokyo</option>
            <option>UTC</option>
          </select>
        </div>
      </section>

      {/* ---------- Dispositivos ---------- */}
      <section className={styles.section}>
        <h2 className={styles.h}>Dispositivos</h2>
        {subs.length === 0 && (
          <p className={styles.empty}>Aún no has conectado ningún dispositivo.</p>
        )}
        {subs.length > 0 && (
          <ul className={styles.devices}>
            {subs.map((s) => (
              <li key={s.id} className={styles.device}>
                <div>
                  <div className={styles.deviceUA}>{s.user_agent?.slice(0, 80) || 'desconocido'}</div>
                  <div className={styles.deviceMeta}>
                    Añadido {new Date(s.created_at).toLocaleDateString('es-ES')}
                    {s.last_used_at && ` · último uso ${new Date(s.last_used_at).toLocaleDateString('es-ES')}`}
                    {s.last_error && <span className={styles.deviceErr}> · error: {s.last_error.slice(0, 40)}</span>}
                  </div>
                </div>
                <button onClick={() => removeSub(s.endpoint)} className={styles.removeBtn}>
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          onClick={enableOnThisDevice}
          disabled={browserPermission === 'denied'}
          className={styles.primary}
        >
          {browserPermission === 'denied'
            ? 'Permisos denegados en este navegador'
            : 'Conectar este dispositivo'}
        </button>
      </section>

      {/* ---------- Tipos ---------- */}
      <section className={styles.section}>
        <h2 className={styles.h}>Tipos de aviso</h2>
        {Object.entries(TYPE_LABELS).map(([key, info]) => (
          <ToggleField
            key={key}
            checked={settings.push_types_enabled[key] !== false}
            onChange={(v) => toggleType(key, v)}
            label={info.label}
            desc={info.desc}
          />
        ))}
      </section>

      {/* ---------- Cuándo avisar ---------- */}
      <section className={styles.section}>
        <h2 className={styles.h}>Anticipación</h2>
        <p className={styles.sectionHint}>
          Cuántos minutos antes del evento quieres recibir el aviso. Puedes elegir varios.
        </p>
        <div className={styles.chips}>
          {OFFSET_OPTIONS.map((o) => (
            <button
              key={o.v}
              onClick={() => toggleOffset(o.v)}
              className={`${styles.chip} ${settings.push_offsets_minutes.includes(o.v) ? styles.chipActive : ''}`}
            >
              {o.l}
            </button>
          ))}
        </div>
      </section>

      {/* ---------- Silencio nocturno ---------- */}
      <section className={styles.section}>
        <h2 className={styles.h}>Silencio nocturno</h2>
        <ToggleField
          checked={settings.quiet_hours_enabled}
          onChange={(v) => patchSettings({ quiet_hours_enabled: v })}
          label="No enviar push en horario silencioso"
          desc="Si llega un aviso durante esta franja, se descarta (no se acumula)."
        />
        <div className={styles.timeRow}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Desde</span>
            <input
              type="time"
              value={settings.quiet_hours_start}
              onChange={(e) => patchSettings({ quiet_hours_start: e.target.value })}
              disabled={!settings.quiet_hours_enabled || busy}
              className={styles.input}
            />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Hasta</span>
            <input
              type="time"
              value={settings.quiet_hours_end}
              onChange={(e) => patchSettings({ quiet_hours_end: e.target.value })}
              disabled={!settings.quiet_hours_enabled || busy}
              className={styles.input}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

// ---------- Sub-component ----------

function ToggleField({
  checked, onChange, label, desc,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  desc: string;
}) {
  return (
    <label className={styles.toggleRow}>
      <span className={styles.toggleText}>
        <strong>{label}</strong>
        <span className={styles.toggleDesc}>{desc}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={styles.toggleHidden}
      />
      <span className={`${styles.toggleSwitch} ${checked ? styles.toggleOn : ''}`}>
        <span className={styles.toggleKnob} />
      </span>
    </label>
  );
}
