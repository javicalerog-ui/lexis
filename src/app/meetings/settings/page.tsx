'use client';

// Ajustes del grabador de reuniones (tabla acta_settings vía Worker).
// Port de app/src/screens/Settings.tsx de Acta. Las notificaciones usan la
// PWA/SW de Lexis y su par VAPID (compartidos desde la consolidación).

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/acta/api';
import { subscribePush } from '@/lib/acta/push';
import { TemplateMeta } from '@/lib/acta/format';

interface SettingsRow {
  default_template: string;
  default_language: string;
  auto_approve: boolean;
  retention_days: number;
  push_enabled: boolean;
}

export default function MeetingsSettingsPage() {
  const router = useRouter();
  const [s, setS] = useState<SettingsRow | null>(null);
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<SettingsRow>('/api/settings').then(setS).catch((e) => setMsg(String(e)));
    api<TemplateMeta[]>('/api/templates').then(setTemplates).catch(() => undefined);
  }, []);

  async function patch(values: Partial<SettingsRow>) {
    setBusy(true);
    setMsg(null);
    try {
      const updated = await api<SettingsRow>('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify(values),
      });
      setS(updated);
      setMsg('Guardado.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function enablePush() {
    setBusy(true);
    setMsg(null);
    const result = await subscribePush().catch((e) => {
      setMsg(String(e));
      return 'unavailable' as const;
    });
    if (result === 'ok') setMsg('Notificaciones activadas en este móvil.');
    if (result === 'denied') setMsg('Permiso denegado en el navegador.');
    if (result === 'unavailable')
      setMsg('No disponible: en iPhone añade Lexis a la pantalla de inicio (iOS 16.4+).');
    setBusy(false);
  }

  async function testPush() {
    setBusy(true);
    setMsg(null);
    try {
      await api('/api/push/test', { method: 'POST' });
      setMsg('Push de prueba enviado.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!s) return <section className="card">Cargando ajustes…</section>;

  return (
    <>
      <section className="card">
        <button className="btn-ghost" onClick={() => router.push('/meetings')}>
          ← Actas
        </button>
        <h2 style={{ marginTop: 8 }}>Ajustes</h2>

        <label htmlFor="s-tpl">Plantilla por defecto</label>
        <select
          id="s-tpl"
          value={s.default_template}
          disabled={busy}
          onChange={(e) => patch({ default_template: e.target.value })}
        >
          {(templates.length ? templates : [{ key: s.default_template, name: s.default_template, sections: [] }]).map(
            (t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            )
          )}
        </select>

        <label htmlFor="s-lang" style={{ marginTop: 12 }}>
          Idioma por defecto
        </label>
        <select
          id="s-lang"
          value={s.default_language}
          disabled={busy}
          onChange={(e) => patch({ default_language: e.target.value })}
        >
          <option value="es">Español</option>
          <option value="en">English</option>
          <option value="auto">Detección automática</option>
        </select>

        <label className="check" style={{ marginTop: 14 }}>
          <input
            type="checkbox"
            checked={s.auto_approve}
            disabled={busy}
            onChange={(e) => patch({ auto_approve: e.target.checked })}
          />
          Aprobar y enviar a Lexis automáticamente (sin revisión)
        </label>

        <label htmlFor="s-ret" style={{ marginTop: 14 }}>
          Retención del audio (días) — transcript y brief se conservan siempre
        </label>
        <input
          id="s-ret"
          type="number"
          min={1}
          max={365}
          defaultValue={s.retention_days}
          disabled={busy}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (v >= 1 && v <= 365 && v !== s.retention_days) patch({ retention_days: v });
          }}
        />
      </section>

      <section className="card">
        <h2>Notificaciones</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          Aviso cuando un acta esté lista para revisar. En iPhone requiere Lexis
          añadida a la pantalla de inicio.
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={s.push_enabled}
            disabled={busy}
            onChange={(e) => patch({ push_enabled: e.target.checked })}
          />
          Recibir notificaciones
        </label>
        <div className="row-actions" style={{ marginTop: 12 }}>
          <button className="btn-secondary" onClick={enablePush} disabled={busy}>
            Activar en este móvil
          </button>
          <button className="btn-secondary" onClick={testPush} disabled={busy}>
            Enviar prueba
          </button>
        </div>
      </section>

      {msg && <p className="hint" style={{ paddingLeft: 4 }}>{msg}</p>}
    </>
  );
}
