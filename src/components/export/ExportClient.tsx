'use client';

import { useState } from 'react';
import styles from './ExportClient.module.css';

interface Counts {
  memories: number;
  projects: number;
  entities: number;
  interview_sessions: number;
  digests: number;
}

interface Props {
  counts: Counts;
}

export function ExportClient({ counts }: Props) {
  const [includeInterviews, setIncludeInterviews] = useState(true);
  const [includeDigests, setIncludeDigests] = useState(true);
  const [includeEmbeddings, setIncludeEmbeddings] = useState(false);
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSuccess, setLastSuccess] = useState<{ size: number; memories: number } | null>(null);

  // Estimación de tamaño (muy aproximada)
  const estimatedKB = Math.round(
    counts.memories * 0.6 +
      counts.projects * 0.4 +
      counts.entities * 0.5 +
      (includeInterviews ? counts.interview_sessions * 2 : 0) +
      (includeDigests ? counts.digests * 3 : 0) +
      (includeEmbeddings ? counts.memories * 10 : 0)
  );

  async function download() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setLastSuccess(null);
    try {
      const body: any = {
        include_interviews: includeInterviews,
        include_digests: includeDigests,
        include_embeddings: includeEmbeddings,
        as_download: true,
      };
      if (dateFrom) body.date_from = new Date(dateFrom).toISOString();
      if (dateTo) {
        const d = new Date(dateTo);
        d.setHours(23, 59, 59, 999);
        body.date_to = d.toISOString();
      }

      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      }

      const memoryCount = parseInt(res.headers.get('X-Memory-Count') ?? '0');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const dateStamp = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lexis-export-${dateStamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setLastSuccess({ size: blob.size, memories: memoryCount });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className={styles.statsRow}>
        <Stat label="Memorias" value={counts.memories} accent />
        <Stat label="Proyectos" value={counts.projects} />
        <Stat label="Entidades" value={counts.entities} />
        <Stat label="Sesiones entrevista" value={counts.interview_sessions} muted={!includeInterviews} />
        <Stat label="Digests" value={counts.digests} muted={!includeDigests} />
      </section>

      <section className={styles.card}>
        <header className={styles.head}>
          <span className={styles.glyph} aria-hidden>⤒</span>
          <div>
            <h2 className={styles.title}>Configurar export</h2>
            <p className={styles.sub}>
              Tamaño estimado: ~<span className={styles.size}>{formatSize(estimatedKB)}</span>
            </p>
          </div>
        </header>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Qué incluir</h3>
          <div className={styles.toggleList}>
            <Toggle
              checked={includeInterviews}
              onChange={setIncludeInterviews}
              label="Sesiones de entrevista"
              hint={`${counts.interview_sessions} sesiones`}
            />
            <Toggle
              checked={includeDigests}
              onChange={setIncludeDigests}
              label="Digests periódicos"
              hint={`${counts.digests} digests`}
            />
            <Toggle
              checked={includeEmbeddings}
              onChange={setIncludeEmbeddings}
              label="Embeddings (vectores)"
              hint="1024 floats por memoria — solo si quieres replicar la búsqueda semántica en otro sitio"
              warning
            />
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Rango de fechas (opcional)</h3>
          <div className={styles.dateRow}>
            <div className={styles.dateField}>
              <label>Desde</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className={styles.dateInput}
              />
            </div>
            <div className={styles.dateField}>
              <label>Hasta</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className={styles.dateInput}
              />
            </div>
            {(dateFrom || dateTo) && (
              <button
                onClick={() => {
                  setDateFrom('');
                  setDateTo('');
                }}
                className={styles.clearDates}
              >
                limpiar
              </button>
            )}
          </div>
        </div>

        {error && <p className={styles.error}>{error}</p>}
        {lastSuccess && (
          <p className={styles.success}>
            ✓ Exportadas <strong>{lastSuccess.memories}</strong> memorias en{' '}
            <strong>{formatSize(lastSuccess.size / 1024)}</strong>. El archivo se ha
            descargado.
          </p>
        )}

        <button onClick={download} disabled={busy} className={styles.downloadBtn}>
          {busy ? (
            <span className={styles.dots}><span /><span /><span /></span>
          ) : (
            <>
              <span>⤓</span>
              <span>Descargar JSON</span>
            </>
          )}
        </button>
      </section>

      <section className={styles.cliCard}>
        <h3 className={styles.cliTitle}>Vía CLI</h3>
        <p className={styles.cliIntro}>
          Si tienes un Personal Access Token con scope <code>read</code>, también
          puedes descargar desde terminal:
        </p>
        <pre className={styles.code}>
{`curl -X POST -H "Authorization: Bearer pat_xxx" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(
    {
      include_interviews: includeInterviews,
      include_digests: includeDigests,
      include_embeddings: includeEmbeddings,
    },
    null,
    0
  )}' \\
  ${typeof window !== 'undefined' ? window.location.origin : 'https://lexis.tu-dominio.com'}/api/export \\
  -o lexis-backup-$(date +%Y-%m-%d).json`}
        </pre>
      </section>
    </>
  );
}

function Stat({
  label,
  value,
  accent,
  muted,
}: {
  label: string;
  value: number;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`${styles.stat} ${accent ? styles.statAccent : ''} ${
        muted ? styles.statMuted : ''
      }`}
    >
      <span className={styles.statN}>{value}</span>
      <span className={styles.statL}>{label}</span>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
  warning,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
  warning?: boolean;
}) {
  return (
    <label className={`${styles.toggle} ${checked ? styles.toggleOn : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={styles.hidden}
      />
      <span className={styles.toggleSwitch}>
        <span className={styles.toggleKnob} />
      </span>
      <span className={styles.toggleMain}>
        <span className={styles.toggleLabel}>{label}</span>
        <span className={`${styles.toggleHint} ${warning ? styles.toggleHintWarn : ''}`}>
          {hint}
        </span>
      </span>
    </label>
  );
}

function formatSize(kb: number): string {
  if (kb < 1) return '< 1 KB';
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
