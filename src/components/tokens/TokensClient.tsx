'use client';

import { useState, useEffect } from 'react';
import styles from './TokensClient.module.css';

interface Token {
  id: string;
  name: string;
  token_prefix: string;
  token_last_four: string;
  scopes: ('read' | 'write')[];
  last_used_at: string | null;
  last_used_ip: string | null;
  last_used_user_agent: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export function TokensClient() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [scopeRead, setScopeRead] = useState(true);
  const [scopeWrite, setScopeWrite] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState<number | null>(null);

  // Show plain token once
  const [justCreated, setJustCreated] = useState<{
    plain: string;
    name: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tokens');
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error);
      setTokens(data.tokens);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createToken() {
    if (creating) return;
    if (!name.trim()) {
      setError('Pon un nombre descriptivo al token.');
      return;
    }
    const scopes: ('read' | 'write')[] = [];
    if (scopeRead) scopes.push('read');
    if (scopeWrite) scopes.push('write');
    if (!scopes.length) {
      setError('Selecciona al menos un scope.');
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const expires_at = expiresInDays
        ? new Date(Date.now() + expiresInDays * 86400_000).toISOString()
        : null;

      const res = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), scopes, expires_at }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error);

      setJustCreated({ plain: data.plain_text, name: data.token.name });
      setName('');
      setScopeRead(true);
      setScopeWrite(false);
      setExpiresInDays(null);
      setShowForm(false);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  }

  async function revokeToken(t: Token) {
    if (!confirm(`Revocar el token "${t.name}"? Esta acción no se puede deshacer.`)) return;
    try {
      const res = await fetch(`/api/tokens/${t.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback simple: seleccionar el contenido
    }
  }

  const activeTokens = tokens.filter((t) => !t.revoked_at);
  const revokedTokens = tokens.filter((t) => !!t.revoked_at);

  return (
    <>
      {justCreated && (
        <section className={styles.created}>
          <header className={styles.createdHead}>
            <span className={styles.successDot} />
            <h2 className={styles.createdTitle}>Token creado: {justCreated.name}</h2>
          </header>
          <p className={styles.createdWarn}>
            <strong>Cópialo ahora.</strong> No podrás volver a verlo. Si lo pierdes,
            tendrás que revocarlo y crear uno nuevo.
          </p>
          <div className={styles.tokenBox}>
            <code className={styles.tokenPlain}>{justCreated.plain}</code>
            <button
              onClick={() => copyToClipboard(justCreated.plain)}
              className={styles.copyBtn}
            >
              {copied ? '✓ Copiado' : 'Copiar'}
            </button>
          </div>
          <button onClick={() => setJustCreated(null)} className={styles.dismissBtn}>
            Lo he guardado
          </button>
        </section>
      )}

      {!showForm && !justCreated && (
        <button onClick={() => setShowForm(true)} className={styles.createCta}>
          + Crear token nuevo
        </button>
      )}

      {showForm && (
        <section className={styles.form}>
          <header className={styles.formHead}>
            <h2 className={styles.formTitle}>Nuevo token</h2>
            <button onClick={() => setShowForm(false)} className={styles.closeBtn}>
              ×
            </button>
          </header>

          <div className={styles.field}>
            <label className={styles.label}>Nombre</label>
            <input
              type="text"
              className={styles.input}
              placeholder="p.ej. n8n production"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Scopes</label>
            <div className={styles.scopeRow}>
              <label className={`${styles.scopeChip} ${scopeRead ? styles.scopeActive : ''}`}>
                <input
                  type="checkbox"
                  checked={scopeRead}
                  onChange={(e) => setScopeRead(e.target.checked)}
                  className={styles.hiddenInput}
                />
                <span className={styles.scopeBox}>{scopeRead ? '●' : ''}</span>
                <span>
                  <span className={styles.scopeName}>read</span>
                  <span className={styles.scopeDesc}>Leer memorias, proyectos, entidades</span>
                </span>
              </label>
              <label className={`${styles.scopeChip} ${scopeWrite ? styles.scopeActiveViolet : ''}`}>
                <input
                  type="checkbox"
                  checked={scopeWrite}
                  onChange={(e) => setScopeWrite(e.target.checked)}
                  className={styles.hiddenInput}
                />
                <span className={styles.scopeBox}>{scopeWrite ? '●' : ''}</span>
                <span>
                  <span className={styles.scopeName}>write</span>
                  <span className={styles.scopeDesc}>Capturar memorias nuevas</span>
                </span>
              </label>
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Caducidad</label>
            <div className={styles.expiresRow}>
              {[null, 30, 90, 365].map((d) => (
                <button
                  key={String(d)}
                  type="button"
                  onClick={() => setExpiresInDays(d)}
                  className={`${styles.expirePill} ${
                    expiresInDays === d ? styles.expireActive : ''
                  }`}
                >
                  {d === null ? 'Sin caducidad' : `${d}d`}
                </button>
              ))}
            </div>
          </div>

          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.formActions}>
            <button onClick={() => setShowForm(false)} className={styles.btnGhost}>
              Cancelar
            </button>
            <button onClick={createToken} disabled={creating} className={styles.btnPrimary}>
              {creating ? 'Creando…' : 'Crear token'}
            </button>
          </div>
        </section>
      )}

      {error && !showForm && (
        <p className={styles.error}>{error}</p>
      )}

      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <span className={styles.dotAccent} />
          <h2 className={styles.sectionTitle}>Activos</h2>
          <span className={styles.sectionCount}>{activeTokens.length}</span>
        </header>

        {loading && activeTokens.length === 0 && (
          <p className={styles.loadingNote}>Cargando…</p>
        )}

        {!loading && activeTokens.length === 0 && (
          <p className={styles.empty}>
            Ningún token activo. Crea uno para empezar a usar la API.
          </p>
        )}

        <ul className={styles.list}>
          {activeTokens.map((t) => (
            <li key={t.id} className={styles.row}>
              <div className={styles.rowMain}>
                <h3 className={styles.rowName}>{t.name}</h3>
                <div className={styles.rowMeta}>
                  <code className={styles.tokenMask}>
                    {t.token_prefix}…{t.token_last_four}
                  </code>
                  {t.scopes.map((s) => (
                    <span
                      key={s}
                      className={`${styles.scopeTag} ${
                        s === 'write' ? styles.scopeTagWrite : ''
                      }`}
                    >
                      {s}
                    </span>
                  ))}
                </div>
                <div className={styles.rowFooter}>
                  <span>
                    {t.last_used_at
                      ? `usado ${relativeTime(t.last_used_at)}${
                          t.last_used_ip ? ` desde ${t.last_used_ip}` : ''
                        }`
                      : 'nunca usado'}
                  </span>
                  <span className={styles.metaDot} />
                  <span>creado {fmtDate(t.created_at)}</span>
                  {t.expires_at && (
                    <>
                      <span className={styles.metaDot} />
                      <span className={styles.expiresMeta}>
                        caduca {fmtDate(t.expires_at)}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <button onClick={() => revokeToken(t)} className={styles.revokeBtn}>
                Revocar
              </button>
            </li>
          ))}
        </ul>
      </section>

      {revokedTokens.length > 0 && (
        <section className={styles.section}>
          <header className={styles.sectionHead}>
            <span className={styles.dotMuted} />
            <h2 className={styles.sectionTitle}>Revocados</h2>
            <span className={styles.sectionCount}>{revokedTokens.length}</span>
          </header>
          <ul className={styles.list}>
            {revokedTokens.slice(0, 10).map((t) => (
              <li key={t.id} className={`${styles.row} ${styles.rowRevoked}`}>
                <div className={styles.rowMain}>
                  <h3 className={styles.rowName}>{t.name}</h3>
                  <div className={styles.rowMeta}>
                    <code className={styles.tokenMask}>
                      {t.token_prefix}…{t.token_last_four}
                    </code>
                  </div>
                  <div className={styles.rowFooter}>
                    <span>revocado {fmtDate(t.revoked_at!)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={styles.docsCard}>
        <h3 className={styles.docsTitle}>Cómo usar tu token</h3>
        <pre className={styles.code}>
{`# Listar memorias recientes
curl -H "Authorization: Bearer pat_xxx" \\
  ${typeof window !== 'undefined' ? window.location.origin : 'https://tu-dominio'}/api/v1/memories?limit=10

# Capturar memoria nueva (requiere scope write)
curl -X POST -H "Authorization: Bearer pat_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"content": "Reunión con Alfonso sobre Polonia"}' \\
  ${typeof window !== 'undefined' ? window.location.origin : 'https://tu-dominio'}/api/v1/memories

# Búsqueda semántica
curl -X POST -H "Authorization: Bearer pat_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"query": "decisiones de marzo"}' \\
  ${typeof window !== 'undefined' ? window.location.origin : 'https://tu-dominio'}/api/v1/search

# Export completo (requiere scope read)
curl -X POST -H "Authorization: Bearer pat_xxx" \\
  -H "Content-Type: application/json" -d '{}' \\
  ${typeof window !== 'undefined' ? window.location.origin : 'https://tu-dominio'}/api/export \\
  -o lexis-backup.json`}
        </pre>
      </section>
    </>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
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
  return fmtDate(iso);
}
