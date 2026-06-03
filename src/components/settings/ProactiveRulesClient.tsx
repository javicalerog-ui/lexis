'use client';

import { useState } from 'react';
import { fetchJson } from '@/lib/fetch-json';
import styles from './ProactiveRulesClient.module.css';

interface Rule {
  id: string;
  kind: 'preset' | 'custom';
  preset_key: string | null;
  name: string;
  description: string | null;
  trigger_type: 'cron' | 'event';
  trigger_config: any;
  action_type: string;
  action_payload: any;
  enabled: boolean;
  timezone: string;
  last_fired_at: string | null;
  next_due_at: string | null;
  created_at: string;
}

interface DraftRule {
  name: string;
  description: string;
  trigger_type: 'cron' | 'event';
  cron: string;
  event_kind: string;
  action_type: string;
  title: string;
  body: string;
}

interface ConflictInfo {
  kind: 'duplicate' | 'overlap' | 'shadowing';
  explanation: string;
  confidence: number;
  conflicting_rule: Rule;
  new_rule_draft: any;
}

const EVENT_KINDS = [
  { v: 'event_due_today', l: 'Cuando vence un evento hoy' },
  { v: 'meeting_in_window', l: 'Antes de una reunión (X min)' },
  { v: 'no_capture_for_days', l: 'Sin capturas por N días' },
];

export function ProactiveRulesClient({
  initialRules,
}: {
  initialRules: Rule[];
}) {
  const [rules, setRules] = useState<Rule[]>(initialRules);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const [draft, setDraft] = useState<DraftRule>({
    name: '',
    description: '',
    trigger_type: 'cron',
    cron: '0 9 * * 1',
    event_kind: 'event_due_today',
    action_type: 'push_simple',
    title: '',
    body: '',
  });

  async function toggleRule(id: string, enabled: boolean) {
    setBusy(true); setError(null);
    try {
      const data = await fetchJson(`/api/proactive-rules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      setRules((prev) => prev.map((r) => (r.id === id ? data.rule : r)));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteRule(id: string) {
    if (!confirm('¿Borrar esta regla?')) return;
    setBusy(true); setError(null);
    try {
      await fetchJson(`/api/proactive-rules/${id}`, { method: 'DELETE' });
      setRules((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function buildCreatePayload() {
    const trigger_config: any = {};
    if (draft.trigger_type === 'cron') {
      trigger_config.cron = draft.cron;
    } else {
      trigger_config.event_kind = draft.event_kind;
      if (draft.event_kind === 'meeting_in_window') trigger_config.minutes_before = 30;
      if (draft.event_kind === 'no_capture_for_days') trigger_config.threshold_days = 14;
    }
    return {
      name: draft.name,
      description: draft.description,
      trigger_type: draft.trigger_type,
      trigger_config,
      action_type: draft.action_type,
      action_payload: {
        title: draft.title || draft.name,
        body: draft.body || draft.description,
      },
    };
  }

  async function submitCreate(opts: { force?: boolean; disablePresetId?: string } = {}) {
    setBusy(true); setError(null);
    try {
      const payload = buildCreatePayload();
      const qs = new URLSearchParams();
      if (opts.force) qs.set('force', 'true');
      if (opts.disablePresetId) qs.set('disable_preset_id', opts.disablePresetId);
      const url = '/api/proactive-rules' + (qs.toString() ? `?${qs}` : '');

      // NO migrado a fetchJson: el path 409 necesita el body (data.conflict)
      // para mostrar el diálogo de conflicto. Comprobamos status ANTES de
      // parsear y parseamos el cuerpo de forma defensiva para no reventar con
      // "Unexpected token '<'" si la plataforma devuelve HTML de error.
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const raw = await res.text();
      let data: any = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error(`respuesta no-JSON (${res.status})`);
      }

      if (res.status === 409 && data.conflict) {
        setConflict(data.conflict);
        setBusy(false);
        return;
      }
      if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);

      // Si deshabilitamos un preset, refrescamos lista entera
      if (opts.disablePresetId) {
        const listData = await fetchJson('/api/proactive-rules');
        setRules(listData.rules || []);
      } else {
        setRules((prev) => [...prev, data.rule]);
      }
      setCreating(false);
      setConflict(null);
      resetDraft();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function resetDraft() {
    setDraft({
      name: '',
      description: '',
      trigger_type: 'cron',
      cron: '0 9 * * 1',
      event_kind: 'event_due_today',
      action_type: 'push_simple',
      title: '',
      body: '',
    });
  }

  function describeTrigger(r: Rule | { trigger_type: string; trigger_config: any }): string {
    if (r.trigger_type === 'cron') {
      const c = (r.trigger_config?.cron as string) || '';
      return `cron: ${c}`;
    }
    const ek = r.trigger_config?.event_kind;
    return `evento: ${ek || '?'}`;
  }

  const presetRules = rules.filter((r) => r.kind === 'preset');
  const customRules = rules.filter((r) => r.kind === 'custom');

  return (
    <div>
      {error && <div className={styles.error}>{error}</div>}

      {/* ---------- Conflicto detectado ---------- */}
      {conflict && (
        <div className={styles.conflictBackdrop}>
          <div className={styles.conflictDialog}>
            <header className={styles.conflictHead}>
              <span className={styles.conflictGlyph}>⚠</span>
              <h2>Posible conflicto detectado</h2>
            </header>

            <p className={styles.conflictExplain}>{conflict.explanation}</p>
            <p className={styles.conflictMeta}>
              Tipo de conflicto: <strong>{conflict.kind}</strong> · confianza {(conflict.confidence * 100).toFixed(0)}%
            </p>

            <div className={styles.conflictCompare}>
              <div className={styles.conflictCard}>
                <span className={styles.conflictTag}>Tu nueva regla</span>
                <h3>{conflict.new_rule_draft.name}</h3>
                <p>{conflict.new_rule_draft.description}</p>
                <code className={styles.code}>
                  {describeTrigger(conflict.new_rule_draft)}
                </code>
              </div>
              <div className={styles.conflictCard}>
                <span className={styles.conflictTag}>Regla en conflicto</span>
                <h3>{conflict.conflicting_rule.name}</h3>
                <p>{conflict.conflicting_rule.description}</p>
                <code className={styles.code}>
                  {describeTrigger(conflict.conflicting_rule)}
                </code>
                <span className={styles.conflictKind}>
                  {conflict.conflicting_rule.kind === 'preset' ? 'preset del sistema' : 'tu regla custom'}
                </span>
              </div>
            </div>

            <div className={styles.conflictActions}>
              <button
                onClick={() => submitCreate({ force: true, disablePresetId: conflict.conflicting_rule.id })}
                className={styles.btnPrimary}
                disabled={busy}
              >
                Quedarme con la mía
                <span className={styles.btnSub}>(deshabilita "{conflict.conflicting_rule.name}")</span>
              </button>
              <button
                onClick={() => { setConflict(null); setCreating(false); resetDraft(); }}
                className={styles.btnGhost}
                disabled={busy}
              >
                Quedarme con la existente
                <span className={styles.btnSub}>(descarta la nueva)</span>
              </button>
              <button
                onClick={() => submitCreate({ force: true })}
                className={styles.btnSecondary}
                disabled={busy}
              >
                Mantener ambas
                <span className={styles.btnSub}>(asumo el doble aviso)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Presets ---------- */}
      <section className={styles.section}>
        <h2 className={styles.h}>Reglas del sistema</h2>
        <p className={styles.sectionHint}>
          Las 5 reglas preset que Lexis sugiere. Puedes deshabilitarlas pero no borrarlas.
        </p>
        <ul className={styles.ruleList}>
          {presetRules.map((r) => (
            <RuleCard
              key={r.id}
              rule={r}
              onToggle={(v) => toggleRule(r.id, v)}
              busy={busy}
              describeTrigger={describeTrigger}
            />
          ))}
        </ul>
      </section>

      {/* ---------- Customs ---------- */}
      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <h2 className={styles.h}>Tus reglas</h2>
          <button
            onClick={() => setCreating(true)}
            className={styles.addBtn}
            disabled={creating}
          >
            + Nueva regla
          </button>
        </header>
        {customRules.length === 0 && !creating && (
          <p className={styles.empty}>Aún no has creado ninguna regla custom.</p>
        )}
        <ul className={styles.ruleList}>
          {customRules.map((r) => (
            <RuleCard
              key={r.id}
              rule={r}
              onToggle={(v) => toggleRule(r.id, v)}
              onDelete={() => deleteRule(r.id)}
              busy={busy}
              describeTrigger={describeTrigger}
            />
          ))}
        </ul>

        {creating && (
          <div className={styles.draftBox}>
            <h3 className={styles.draftTitle}>Nueva regla</h3>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Nombre</span>
              <input
                className={styles.input}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Repaso de domingo por la noche"
              />
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Descripción</span>
              <textarea
                className={styles.textarea}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="Qué hace y para qué (te ayuda a entenderte a ti mismo dentro de 3 meses)"
                rows={2}
              />
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Tipo de disparador</span>
              <div className={styles.toggleGroup}>
                <button
                  onClick={() => setDraft({ ...draft, trigger_type: 'cron' })}
                  className={`${styles.segBtn} ${draft.trigger_type === 'cron' ? styles.segBtnActive : ''}`}
                >
                  Horario fijo
                </button>
                <button
                  onClick={() => setDraft({ ...draft, trigger_type: 'event' })}
                  className={`${styles.segBtn} ${draft.trigger_type === 'event' ? styles.segBtnActive : ''}`}
                >
                  Evento del grafo
                </button>
              </div>
            </div>
            {draft.trigger_type === 'cron' ? (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>
                  Cron <span className={styles.fieldHint}>min hora día mes diaSemana (0=domingo)</span>
                </span>
                <input
                  className={`${styles.input} ${styles.mono}`}
                  value={draft.cron}
                  onChange={(e) => setDraft({ ...draft, cron: e.target.value })}
                  placeholder="0 9 * * 1"
                />
              </div>
            ) : (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Tipo de evento</span>
                <select
                  className={styles.input}
                  value={draft.event_kind}
                  onChange={(e) => setDraft({ ...draft, event_kind: e.target.value })}
                >
                  {EVENT_KINDS.map((k) => <option key={k.v} value={k.v}>{k.l}</option>)}
                </select>
              </div>
            )}
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Título del aviso</span>
              <input
                className={styles.input}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="(usa el nombre de la regla si lo dejas vacío)"
              />
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Cuerpo del aviso</span>
              <textarea
                className={styles.textarea}
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                rows={2}
              />
            </div>
            <div className={styles.draftActions}>
              <button
                onClick={() => submitCreate()}
                disabled={busy || !draft.name.trim()}
                className={styles.btnPrimary}
              >
                {busy ? 'Comprobando…' : 'Guardar regla'}
              </button>
              <button
                onClick={() => { setCreating(false); resetDraft(); }}
                disabled={busy}
                className={styles.btnGhost}
              >
                Cancelar
              </button>
            </div>
            <p className={styles.draftFootnote}>
              Antes de guardarla, Lexis comprueba si solapa con tus reglas activas y te avisa para decidir.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------- RuleCard ----------

function RuleCard({
  rule, onToggle, onDelete, busy, describeTrigger,
}: {
  rule: Rule;
  onToggle: (v: boolean) => void;
  onDelete?: () => void;
  busy: boolean;
  describeTrigger: (r: Rule) => string;
}) {
  return (
    <li className={`${styles.card} ${!rule.enabled ? styles.cardDisabled : ''}`}>
      <div className={styles.cardMain}>
        <div className={styles.cardTitleRow}>
          <h3 className={styles.cardTitle}>{rule.name}</h3>
          {rule.kind === 'preset' && (
            <span className={styles.tag}>preset</span>
          )}
        </div>
        {rule.description && <p className={styles.cardDesc}>{rule.description}</p>}
        <div className={styles.cardMeta}>
          <code className={styles.code}>{describeTrigger(rule)}</code>
          {rule.last_fired_at && (
            <span className={styles.metaSmall}>
              · último disparo {new Date(rule.last_fired_at).toLocaleDateString('es-ES')}
            </span>
          )}
        </div>
      </div>
      <div className={styles.cardActions}>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={rule.enabled}
            onChange={(e) => onToggle(e.target.checked)}
            disabled={busy}
            className={styles.toggleHidden}
          />
          <span className={`${styles.switch} ${rule.enabled ? styles.switchOn : ''}`}>
            <span className={styles.knob} />
          </span>
        </label>
        {onDelete && (
          <button onClick={onDelete} className={styles.deleteBtn} disabled={busy}>
            Borrar
          </button>
        )}
      </div>
    </li>
  );
}
