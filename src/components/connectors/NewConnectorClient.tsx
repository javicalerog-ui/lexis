'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { fetchJson } from '@/lib/fetch-json';
import styles from './NewConnectorClient.module.css';

interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'number' | 'boolean';
  description?: string;
  required?: boolean;
  default?: unknown;
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
}

interface AdapterInfo {
  type: string;
  label: string;
  description: string;
  glyph: string;
  oauth_provider: string | null;
  supports_schedule: boolean;
  supports_webhook: boolean;
  config_schema?: ConfigField[];
}

interface Credential {
  id: string;
  provider: string;
  label: string;
  account_identifier: string | null;
  scopes: string[];
  expires_at: string | null;
  created_at: string;
}

const SCHEDULE_OPTIONS = [
  { value: '', label: 'Sin schedule' },
  { value: 'every:15m', label: 'Cada 15 min' },
  { value: 'every:1h', label: 'Cada hora' },
  { value: 'every:6h', label: 'Cada 6 horas' },
  { value: 'every:1d', label: 'Cada día' },
  { value: 'daily:7', label: 'Diario · 7:00 UTC' },
];

// Mapeo de adapter type a configuración OAuth: scopes a verificar
// y nombre del intent a pasar al endpoint /api/oauth/google/start
const OAUTH_INTENT: Record<string, { intent: string; required_scopes: string[] }> = {
  gmail: {
    intent: 'gmail',
    required_scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  },
  drive: {
    intent: 'drive',
    required_scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  },
  calendar: {
    intent: 'calendar',
    required_scopes: ['https://www.googleapis.com/auth/calendar'],
  },
};

type Step = 'pick' | 'oauth' | 'configure';

export function NewConnectorClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const [step, setStep] = useState<Step>('pick');
  const [selectedType, setSelectedType] = useState<string | null>(null);

  // OAuth state
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loadingCreds, setLoadingCreds] = useState(false);
  const [selectedCredentialsId, setSelectedCredentialsId] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState('');
  const [enableWebhook, setEnableWebhook] = useState(false);
  const [config, setConfig] = useState<Record<string, unknown>>({});

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Result tras crear
  const [created, setCreated] = useState<{
    id: string;
    name: string;
    webhook_secret?: string | null;
    webhook_url?: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  // Cargar adapters
  useEffect(() => {
    fetchJson('/api/connectors?include_adapters=1')
      .then((d) => setAdapters(d.available_adapters || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Detectar vuelta del flow OAuth
  useEffect(() => {
    const credId = searchParams.get('credentials_id');
    const oauthSuccess = searchParams.get('oauth_success');
    const cName = searchParams.get('connector_name');
    const adapterType = searchParams.get('adapter_type');
    if (credId && oauthSuccess === '1' && adapters.length > 0) {
      // Preferir adapter_type explícito; fallback a heurística por nombre
      const lower = (cName || '').toLowerCase();
      const type =
        adapterType ||
        (lower.includes('calendar')
          ? 'calendar'
          : lower.includes('drive')
            ? 'drive'
            : 'gmail');
      const a = adapters.find((x) => x.type === type);
      if (a) {
        setSelectedType(type);
        setSelectedCredentialsId(credId);
        const initialConfig: Record<string, unknown> = {};
        (a.config_schema || []).forEach((f) => {
          if (f.default !== undefined) initialConfig[f.key] = f.default;
        });
        setConfig(initialConfig);
        setName(cName || a.label);
        setStep('configure');
        // Limpiar query params
        router.replace('/connectors/new');
      }
    }
  }, [searchParams, adapters, router]);

  const adapter = adapters.find((a) => a.type === selectedType);

  const loadCredentials = useCallback(
    async (type: string) => {
      const oauthInfo = OAUTH_INTENT[type];
      if (!oauthInfo) return;
      setLoadingCreds(true);
      try {
        const params = new URLSearchParams({
          provider: 'google',
          scopes: oauthInfo.required_scopes.join(','),
        });
        const data = await fetchJson(`/api/credentials?${params.toString()}`);
        setCredentials(data.credentials || []);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoadingCreds(false);
      }
    },
    []
  );

  function selectAdapter(type: string) {
    const a = adapters.find((x) => x.type === type);
    if (!a) return;
    setSelectedType(type);
    setName(`${a.label}`);
    const initialConfig: Record<string, unknown> = {};
    (a.config_schema || []).forEach((f) => {
      if (f.default !== undefined) initialConfig[f.key] = f.default;
    });
    setConfig(initialConfig);
    setEnableWebhook(a.supports_webhook && !a.oauth_provider);

    // Si requiere OAuth, paso intermedio
    if (a.oauth_provider) {
      loadCredentials(type);
      setStep('oauth');
    } else {
      setStep('configure');
    }
  }

  function connectGoogle(type: string, useExistingId?: string) {
    const oauthInfo = OAUTH_INTENT[type];
    if (!oauthInfo) return;
    const params = new URLSearchParams({
      intent: oauthInfo.intent,
      next: '/connectors/new',
      connector_name: name || type,
      adapter_type: type,
    });
    if (useExistingId) params.set('reuse_credentials_id', useExistingId);
    window.location.href = `/api/oauth/google/start?${params.toString()}`;
  }

  function pickExistingCredentials(credId: string) {
    setSelectedCredentialsId(credId);
    setStep('configure');
  }

  async function create() {
    if (!selectedType) return;
    if (!name.trim()) {
      setError('Pon un nombre al connector.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const data = await fetchJson('/api/connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: selectedType,
          name: name.trim(),
          schedule: schedule || null,
          config,
          enable_webhook: enableWebhook,
          credentials_id: selectedCredentialsId,
        }),
      });

      const webhookUrl = data.webhook_secret
        ? `${window.location.origin}/api/connectors/${data.connector.id}/inbound`
        : undefined;

      setCreated({
        id: data.connector.id,
        name: data.connector.name,
        webhook_secret: data.webhook_secret,
        webhook_url: webhookUrl,
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  if (loading) return <p className={styles.loading}>Cargando tipos…</p>;

  // ============ Estado: created ============
  if (created) {
    return (
      <section className={styles.successWrap}>
        <header className={styles.successHead}>
          <span className={styles.successDot} />
          <h2 className={styles.successTitle}>Connector creado: {created.name}</h2>
        </header>

        {created.webhook_secret && created.webhook_url && (
          <div className={styles.webhookInfo}>
            <p className={styles.webhookWarn}>
              <strong>Guarda el webhook secret ahora.</strong> No podrás volver
              a verlo. Si lo pierdes, podrás rotarlo desde la página del connector.
            </p>

            <div className={styles.kvRow}>
              <span className={styles.kvLabel}>URL</span>
              <div className={styles.kvBox}>
                <code className={styles.kvCode}>{created.webhook_url}</code>
                <button
                  onClick={() => copy(created.webhook_url!)}
                  className={styles.miniCopy}
                >
                  copiar
                </button>
              </div>
            </div>

            <div className={styles.kvRow}>
              <span className={styles.kvLabel}>Secret</span>
              <div className={styles.kvBox}>
                <code className={styles.kvCode}>{created.webhook_secret}</code>
                <button
                  onClick={() => copy(created.webhook_secret!)}
                  className={styles.miniCopy}
                >
                  {copied ? '✓' : 'copiar'}
                </button>
              </div>
            </div>

            <details className={styles.exampleWrap}>
              <summary className={styles.exampleHead}>Ejemplo curl</summary>
              <pre className={styles.code}>
{`curl -X POST \\
  -H "X-Connector-Secret: ${created.webhook_secret}" \\
  -H "Content-Type: application/json" \\
  -d '{"content": "Hola desde curl"}' \\
  ${created.webhook_url}`}
              </pre>
            </details>
          </div>
        )}

        <div className={styles.successActions}>
          <Link href={`/connectors/${created.id}`} className={styles.btnPrimary}>
            Ir al connector
          </Link>
          <Link href="/connectors" className={styles.btnGhost}>
            Lista de connectors
          </Link>
        </div>
      </section>
    );
  }

  // ============ Step: oauth ============
  if (step === 'oauth' && adapter && adapter.oauth_provider) {
    return (
      <section className={styles.formWrap}>
        <div className={styles.adapterHead}>
          <span className={styles.adapterGlyph}>{adapter.glyph}</span>
          <div>
            <h2 className={styles.adapterLabel}>{adapter.label}</h2>
            <p className={styles.adapterDesc}>{adapter.description}</p>
          </div>
          <button
            onClick={() => {
              setStep('pick');
              setSelectedType(null);
            }}
            className={styles.changeBtn}
          >
            Cambiar
          </button>
        </div>

        <div className={styles.oauthIntro}>
          <span className={styles.oauthGlyph}>🔐</span>
          <div>
            <h3 className={styles.oauthTitle}>Autorización requerida</h3>
            <p className={styles.oauthDesc}>
              Para conectar {adapter.label} necesitas autorizar Lexis en tu cuenta de{' '}
              {adapter.oauth_provider === 'google' ? 'Google' : adapter.oauth_provider}.
              Solo lectura. Puedes revocar el acceso desde la sección Tokens.
            </p>
          </div>
        </div>

        {loadingCreds ? (
          <p className={styles.loading}>Buscando cuentas conectadas…</p>
        ) : credentials.length > 0 ? (
          <div className={styles.credList}>
            <h4 className={styles.credListTitle}>Cuentas ya autorizadas</h4>
            {credentials.map((c) => (
              <button
                key={c.id}
                onClick={() => pickExistingCredentials(c.id)}
                className={styles.credCard}
              >
                <span className={styles.credGlyph}>G</span>
                <div className={styles.credMain}>
                  <span className={styles.credAccount}>{c.account_identifier}</span>
                  <span className={styles.credMeta}>
                    {c.scopes.length} scopes · añadida{' '}
                    {new Date(c.created_at).toLocaleDateString('es-ES', {
                      day: '2-digit',
                      month: 'short',
                    })}
                  </span>
                </div>
                <span className={styles.credArrow}>→</span>
              </button>
            ))}

            <button
              onClick={() => connectGoogle(adapter.type)}
              className={styles.connectAnother}
            >
              + Conectar otra cuenta
            </button>
          </div>
        ) : (
          <button
            onClick={() => connectGoogle(adapter.type)}
            className={styles.googleBtn}
          >
            <span className={styles.googleG}>G</span>
            <span>Conectar con Google</span>
          </button>
        )}

        {error && <p className={styles.error}>{error}</p>}
      </section>
    );
  }

  // ============ Step: configure ============
  if (step === 'configure' && adapter) {
    const credInUse = credentials.find((c) => c.id === selectedCredentialsId);

    return (
      <section className={styles.formWrap}>
        <div className={styles.adapterHead}>
          <span className={styles.adapterGlyph}>{adapter.glyph}</span>
          <div>
            <h2 className={styles.adapterLabel}>{adapter.label}</h2>
            <p className={styles.adapterDesc}>{adapter.description}</p>
          </div>
          <button
            onClick={() => {
              setStep('pick');
              setSelectedType(null);
              setSelectedCredentialsId(null);
            }}
            className={styles.changeBtn}
          >
            Cambiar
          </button>
        </div>

        {selectedCredentialsId && (
          <div className={styles.credBadge}>
            <span className={styles.credBadgeDot} />
            <span className={styles.credBadgeLabel}>Cuenta conectada</span>
            <span className={styles.credBadgeAccount}>
              {credInUse?.account_identifier || selectedCredentialsId.slice(0, 8)}
            </span>
          </div>
        )}

        <div className={styles.field}>
          <label className={styles.label}>Nombre</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`${adapter.label} principal`}
            className={styles.input}
            maxLength={80}
          />
        </div>

        {adapter.supports_schedule && (
          <div className={styles.field}>
            <label className={styles.label}>Frecuencia</label>
            <div className={styles.scheduleRow}>
              {SCHEDULE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setSchedule(o.value)}
                  className={`${styles.schedulePill} ${
                    schedule === o.value ? styles.scheduleActive : ''
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {adapter.supports_webhook && (
          <div className={styles.field}>
            <label
              className={`${styles.toggleField} ${enableWebhook ? styles.toggleFieldOn : ''}`}
            >
              <input
                type="checkbox"
                checked={enableWebhook}
                onChange={(e) => setEnableWebhook(e.target.checked)}
                className={styles.hidden}
              />
              <span className={styles.switch}>
                <span className={styles.switchKnob} />
              </span>
              <span>
                <strong>Aceptar webhooks entrantes</strong>
                <span className={styles.toggleDesc}>
                  Crea una URL pública con secret para que servicios externos
                  hagan POST a este connector.
                </span>
              </span>
            </label>
          </div>
        )}

        {adapter.config_schema && adapter.config_schema.length > 0 && (
          <div className={styles.configSection}>
            <h3 className={styles.configTitle}>Configuración</h3>
            {adapter.config_schema.map((f) => (
              <DynamicField
                key={f.key}
                field={f}
                value={config[f.key]}
                onChange={(v) => setConfig((prev) => ({ ...prev, [f.key]: v }))}
              />
            ))}
          </div>
        )}

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.formActions}>
          <button
            onClick={() => router.push('/connectors')}
            className={styles.btnGhost}
          >
            Cancelar
          </button>
          <button
            onClick={create}
            disabled={creating}
            className={styles.btnPrimary}
          >
            {creating ? 'Creando…' : 'Crear connector'}
          </button>
        </div>
      </section>
    );
  }

  // ============ Step: pick ============
  return (
    <section>
      <p className={styles.pickHelp}>Elige el tipo de connector que quieres añadir:</p>
      <ul className={styles.adapterGrid}>
        {adapters.map((a) => (
          <li
            key={a.type}
            className={styles.adapterCard}
            onClick={() => selectAdapter(a.type)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                selectAdapter(a.type);
              }
            }}
          >
            <div className={styles.adapterCardTop}>
              <span className={styles.adapterCardGlyph}>{a.glyph}</span>
              <span className={styles.adapterCardLabel}>{a.label}</span>
            </div>
            <p className={styles.adapterCardDesc}>{a.description}</p>
            <div className={styles.adapterCardTags}>
              {a.supports_schedule && (
                <span className={styles.tagPull}>pull</span>
              )}
              {a.supports_webhook && (
                <span className={styles.tagPush}>push</span>
              )}
              {a.oauth_provider && (
                <span className={styles.tagOauth}>oauth</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DynamicField({
  field,
  value,
  onChange,
}: {
  field: ConfigField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  return (
    <div className={styles.dynField}>
      <label className={styles.dynLabel}>
        {field.label}
        {field.required && <span className={styles.req}>·</span>}
      </label>
      {field.description && (
        <p className={styles.dynDesc}>{field.description}</p>
      )}

      {field.type === 'text' && (
        <input
          type="text"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className={styles.input}
        />
      )}

      {field.type === 'textarea' && (
        <textarea
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className={styles.textarea}
          rows={3}
        />
      )}

      {field.type === 'number' && (
        <input
          type="number"
          value={(value as number) ?? ''}
          onChange={(e) =>
            onChange(e.target.value ? parseInt(e.target.value) : null)
          }
          className={styles.input}
        />
      )}

      {field.type === 'select' && field.options && (
        <select
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          className={styles.input}
        >
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}

      {field.type === 'boolean' && (
        <label className={styles.boolField}>
          <input
            type="checkbox"
            checked={(value as boolean) ?? false}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{value ? 'Activado' : 'Desactivado'}</span>
        </label>
      )}
    </div>
  );
}
