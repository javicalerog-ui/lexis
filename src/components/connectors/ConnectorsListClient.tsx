'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { fetchJson } from '@/lib/fetch-json';
import styles from './ConnectorsListClient.module.css';

interface Connector {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  schedule: string | null;
  config: Record<string, unknown>;
  last_run_at: string | null;
  last_run_status: 'success' | 'failed' | 'partial' | 'running' | null;
  last_error: string | null;
  has_webhook: boolean;
  runs_24h: number;
  items_24h: number;
  created_at: string;
}

const TYPE_GLYPH: Record<string, string> = {
  webhook: '⇲',
  rss: '⌁',
  gmail: '✉',
  drive: '◰',
};

export function ConnectorsListClient() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const data = await fetchJson('/api/connectors');
      setConnectors(data.connectors);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleEnabled(c: Connector) {
    try {
      const res = await fetch(`/api/connectors/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !c.enabled }),
      });
      if (!res.ok) throw new Error('toggle_failed');
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  if (loading) {
    return <p className={styles.loading}>Cargando…</p>;
  }

  if (error) {
    return <p className={styles.error}>{error}</p>;
  }

  return (
    <>
      <Link href="/connectors/new" className={styles.cta}>
        + Añadir connector
      </Link>

      {connectors.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyLead}>
            Sin connectors todavía. Empieza con un webhook entrante para integrar
            cualquier servicio que pueda hacer POST.
          </p>
          <Link href="/connectors/new" className={styles.emptyCta}>
            Crear el primero
          </Link>
        </div>
      ) : (
        <ul className={styles.list}>
          {connectors.map((c) => (
            <li key={c.id} className={styles.card}>
              <div className={styles.cardHead}>
                <span className={styles.glyph}>
                  {TYPE_GLYPH[c.type] || '◉'}
                </span>
                <div className={styles.cardTitleRow}>
                  <Link href={`/connectors/${c.id}`} className={styles.name}>
                    {c.name}
                  </Link>
                  <span className={styles.type}>{c.type}</span>
                </div>
                <button
                  onClick={() => toggleEnabled(c)}
                  className={`${styles.toggle} ${c.enabled ? styles.toggleOn : ''}`}
                  title={c.enabled ? 'Deshabilitar' : 'Habilitar'}
                >
                  <span className={styles.toggleKnob} />
                </button>
              </div>

              <div className={styles.metaRow}>
                {c.schedule && (
                  <span className={styles.metaItem}>
                    <span className={styles.metaLabel}>schedule</span>
                    <span className={styles.metaVal}>{c.schedule}</span>
                  </span>
                )}
                {c.has_webhook && (
                  <span className={styles.metaItem}>
                    <span className={styles.metaLabel}>webhook</span>
                    <span className={styles.metaVal}>activo</span>
                  </span>
                )}
                <span className={styles.metaItem}>
                  <span className={styles.metaLabel}>24h</span>
                  <span className={styles.metaVal}>
                    {c.runs_24h} runs · {c.items_24h} items
                  </span>
                </span>
              </div>

              <div className={styles.statusRow}>
                {c.last_run_at ? (
                  <span
                    className={`${styles.statusPill} ${
                      c.last_run_status === 'success'
                        ? styles.pillOk
                        : c.last_run_status === 'failed'
                          ? styles.pillFail
                          : c.last_run_status === 'partial'
                            ? styles.pillPartial
                            : styles.pillNeutral
                    }`}
                  >
                    {c.last_run_status === 'success' && '✓ ok'}
                    {c.last_run_status === 'failed' && '× fallo'}
                    {c.last_run_status === 'partial' && '◐ parcial'}
                    {c.last_run_status === 'running' && '◷ corriendo'}
                  </span>
                ) : (
                  <span className={styles.statusPill}>nunca ejecutado</span>
                )}
                <span className={styles.relTime}>
                  {c.last_run_at ? relativeTime(c.last_run_at) : ''}
                </span>
                {c.last_error && (
                  <span className={styles.errorPreview} title={c.last_error}>
                    {c.last_error.slice(0, 80)}
                    {c.last_error.length > 80 ? '…' : ''}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min}min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `hace ${day}d`;
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
  });
}
