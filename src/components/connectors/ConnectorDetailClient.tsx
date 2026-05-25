'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from './ConnectorDetailClient.module.css';

interface Connector {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  schedule: string | null;
  config: Record<string, unknown>;
  credentials_id: string | null;
  webhook_secret_prefix: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  last_error: string | null;
  last_state: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface Run {
  id: string;
  status: 'running' | 'success' | 'failed' | 'partial';
  trigger: 'cron' | 'manual' | 'webhook';
  started_at: string;
  completed_at: string | null;
  items_fetched: number;
  items_new: number;
  items_skipped: number;
  items_failed: number;
  error_message: string | null;
  payload: Record<string, unknown>;
}

export function ConnectorDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const [connector, setConnector] = useState<Connector | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [showState, setShowState] = useState(false);
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, rRes] = await Promise.all([
        fetch(`/api/connectors/${id}`),
        fetch(`/api/connectors/${id}/runs?limit=20`),
      ]);
      const cData = await cRes.json();
      const rData = await rRes.json();
      if (!cRes.ok) throw new Error(cData.detail || cData.error);
      setConnector(cData.connector);
      setRuns(rData.runs || []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function triggerRun() {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/connectors/${id}/run`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  async function rotateSecret() {
    if (!confirm('¿Rotar el webhook secret? El secret actual dejará de funcionar inmediatamente.')) return;
    try {
      const res = await fetch(`/api/connectors/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rotate_webhook_secret: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error);
      setRotatedSecret(data.webhook_secret);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  async function deleteConnector() {
    if (!confirm(`¿Eliminar el connector "${connector?.name}"? Esta acción no se puede deshacer.`)) return;
    try {
      const res = await fetch(`/api/connectors/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete_failed');
      router.push('/connectors');
    } catch (e) {
      setError(String(e));
    }
  }

  async function toggleEnabled() {
    if (!connector) return;
    try {
      await fetch(`/api/connectors/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !connector.enabled }),
      });
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  if (loading && !connector) return <p className={styles.loading}>Cargando…</p>;
  if (error && !connector) return <p className={styles.error}>{error}</p>;
  if (!connector) return null;

  const webhookUrl = connector.webhook_secret_prefix
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/api/connectors/${connector.id}/inbound`
    : null;

  return (
    <>
      {/* Banner: secret rotado */}
      {rotatedSecret && (
        <section className={styles.rotated}>
          <h3 className={styles.rotatedTitle}>Nuevo webhook secret</h3>
          <p className={styles.rotatedWarn}>
            Guárdalo ahora. El anterior ya no funciona.
          </p>
          <div className={styles.kvBox}>
            <code className={styles.kvCode}>{rotatedSecret}</code>
            <button
              onClick={() => navigator.clipboard.writeText(rotatedSecret)}
              className={styles.miniCopy}
            >
              copiar
            </button>
          </div>
          <button
            onClick={() => setRotatedSecret(null)}
            className={styles.dismissBtn}
          >
            Lo he guardado
          </button>
        </section>
      )}

      {/* Header del connector */}
      <section className={styles.heroCard}>
        <div className={styles.heroTop}>
          <div className={styles.heroLeft}>
            <h2 className={styles.heroName}>{connector.name}</h2>
            <div className={styles.heroMeta}>
              <span className={styles.typeTag}>{connector.type}</span>
              {connector.schedule && (
                <span className={styles.scheduleTag}>{connector.schedule}</span>
              )}
              {connector.webhook_secret_prefix && (
                <span className={styles.webhookTag}>
                  webhook · {connector.webhook_secret_prefix}…
                </span>
              )}
            </div>
          </div>

          <button
            onClick={toggleEnabled}
            className={`${styles.toggle} ${connector.enabled ? styles.toggleOn : ''}`}
            title={connector.enabled ? 'Deshabilitar' : 'Habilitar'}
          >
            <span className={styles.toggleKnob} />
          </button>
        </div>

        <div className={styles.heroActions}>
          <button
            onClick={triggerRun}
            disabled={running || !connector.enabled}
            className={styles.runBtn}
            title={!connector.enabled ? 'Habilita primero el connector' : ''}
          >
            {running ? 'Ejecutando…' : '▷ Ejecutar ahora'}
          </button>
          {webhookUrl && (
            <button onClick={rotateSecret} className={styles.secondaryBtn}>
              ↻ Rotar secret
            </button>
          )}
          <button onClick={deleteConnector} className={styles.dangerBtn}>
            Eliminar
          </button>
        </div>
      </section>

      {error && <p className={styles.errorInline}>{error}</p>}

      {/* Webhook info */}
      {webhookUrl && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>
            <span className={styles.sectDot} />
            Webhook entrante
          </h3>
          <div className={styles.kvRow}>
            <span className={styles.kvLabel}>URL</span>
            <div className={styles.kvBox}>
              <code className={styles.kvCode}>{webhookUrl}</code>
              <button
                onClick={() => navigator.clipboard.writeText(webhookUrl)}
                className={styles.miniCopy}
              >
                copiar
              </button>
            </div>
          </div>
          <p className={styles.webhookHint}>
            Envía POST con header <code>X-Connector-Secret</code> y body JSON o texto plano.
          </p>
        </section>
      )}

      {/* Config */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>
          <span className={styles.sectDot} />
          Configuración
        </h3>
        <pre className={styles.configBox}>
          {JSON.stringify(connector.config, null, 2)}
        </pre>
      </section>

      {/* Estado interno */}
      <section className={styles.section}>
        <button
          onClick={() => setShowState((v) => !v)}
          className={styles.sectionToggle}
        >
          <span className={styles.sectDotMuted} />
          Estado interno
          <span className={styles.expandArrow}>{showState ? '−' : '+'}</span>
        </button>
        {showState && (
          <pre className={styles.configBox}>
            {JSON.stringify(connector.last_state, null, 2)}
          </pre>
        )}
      </section>

      {/* Histórico de runs */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>
          <span className={styles.sectDot} />
          Ejecuciones
          <span className={styles.countTag}>{runs.length}</span>
        </h3>
        {runs.length === 0 ? (
          <p className={styles.emptyNote}>Sin ejecuciones todavía.</p>
        ) : (
          <ul className={styles.runList}>
            {runs.map((r) => (
              <li key={r.id} className={styles.run}>
                <div className={styles.runTop}>
                  <span
                    className={`${styles.runStatus} ${
                      r.status === 'success'
                        ? styles.statusOk
                        : r.status === 'failed'
                          ? styles.statusFail
                          : r.status === 'partial'
                            ? styles.statusPartial
                            : styles.statusRunning
                    }`}
                  >
                    {r.status}
                  </span>
                  <span className={styles.runTrigger}>{r.trigger}</span>
                  <span className={styles.runTime}>
                    {new Date(r.started_at).toLocaleString('es-ES', {
                      month: 'short',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <div className={styles.runStats}>
                  <span>
                    <strong>{r.items_fetched}</strong> fetched
                  </span>
                  <span>
                    <strong className={styles.statNew}>{r.items_new}</strong> nuevas
                  </span>
                  <span>
                    <strong>{r.items_skipped}</strong> duplicadas
                  </span>
                  {r.items_failed > 0 && (
                    <span>
                      <strong className={styles.statFail}>{r.items_failed}</strong> fallidas
                    </span>
                  )}
                </div>
                {r.error_message && (
                  <p className={styles.runError}>{r.error_message}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
