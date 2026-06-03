'use client';

import { useState } from 'react';
import { fetchJson } from '@/lib/fetch-json';
import styles from './NextStepsPanel.module.css';

interface NextStep {
  action: string;
  rationale: string;
  effort: 'quick' | 'medium' | 'deep';
  depends_on: number[] | null;
}

interface Result {
  context_quality: 'rich' | 'moderate' | 'thin';
  headline: string;
  steps: NextStep[];
  blocking_questions: string[];
  confidence: number;
  generated_at: string;
  model_used: string;
  user_question: string | null;
}

type StepLocalStatus = 'pending' | 'completing' | 'done' | 'partial' | 'skipped';

interface Props {
  slug: string;
}

const EFFORT_LABEL: Record<NextStep['effort'], string> = {
  quick: '< 30min',
  medium: 'horas',
  deep: 'días',
};

const QUALITY_HINT: Record<Result['context_quality'], string> = {
  rich: 'contexto sólido',
  moderate: 'contexto suficiente',
  thin: 'poco contexto — captura más memorias para mejorar las propuestas',
};

const STATUS_LABEL: Record<Exclude<StepLocalStatus, 'pending' | 'completing'>, string> = {
  done: 'Hecho',
  partial: 'Parcial',
  skipped: 'Descartado',
};

export function NextStepsPanel({ slug }: Props) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Estado local de cada paso (índice → status) y notas si las completa
  const [stepStatus, setStepStatus] = useState<Record<number, StepLocalStatus>>({});
  const [activeNoteIdx, setActiveNoteIdx] = useState<number | null>(null);
  const [pendingStatus, setPendingStatus] = useState<'done' | 'partial' | 'skipped'>('done');
  const [noteText, setNoteText] = useState('');

  async function fetchSteps() {
    setBusy(true);
    setError(null);
    try {
      const data = await fetchJson(`/api/projects/${slug}/next-steps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(question.trim() ? { question } : {}),
      });
      setResult(data);
      setStepStatus({});
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function openCompleteFlow(idx: number, status: 'done' | 'partial' | 'skipped') {
    setActiveNoteIdx(idx);
    setPendingStatus(status);
    setNoteText('');
  }

  async function confirmComplete() {
    if (activeNoteIdx === null || !result) return;
    const step = result.steps[activeNoteIdx];
    if (!step) return;

    setStepStatus((prev) => ({ ...prev, [activeNoteIdx]: 'completing' }));
    setActiveNoteIdx(null);

    try {
      await fetchJson(`/api/projects/${slug}/next-steps/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: step.action,
          notes: noteText.trim() || undefined,
          status: pendingStatus,
        }),
      });
      setStepStatus((prev) => ({ ...prev, [activeNoteIdx!]: pendingStatus }));
    } catch (e) {
      setError(String(e));
      setStepStatus((prev) => {
        const next = { ...prev };
        if (activeNoteIdx !== null) delete next[activeNoteIdx];
        return next;
      });
    } finally {
      setNoteText('');
    }
  }

  function cancelNote() {
    setActiveNoteIdx(null);
    setNoteText('');
  }

  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <div className={styles.titleWrap}>
          <span className={styles.glyph} aria-hidden>◈</span>
          <h2 className={styles.title}>¿Qué hago ahora?</h2>
        </div>
        <span className={styles.sub}>Asistente proactivo</span>
      </div>

      <div className={styles.controls}>
        <input
          type="text"
          placeholder="¿Algo específico que resolver? (opcional)"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={busy}
          className={styles.input}
          onKeyDown={(e) => {
            if (e.key === 'Enter') fetchSteps();
          }}
        />
        <button onClick={fetchSteps} disabled={busy} className={styles.button}>
          {busy ? (
            <span className={styles.spinner} aria-hidden>
              <span /><span /><span />
            </span>
          ) : result ? (
            'Regenerar'
          ) : (
            'Generar pasos'
          )}
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {result && (
        <div className={styles.result}>
          <div className={styles.headline}>{result.headline}</div>

          <div className={styles.meta}>
            <span className={`${styles.quality} ${styles[`q_${result.context_quality}`]}`}>
              {QUALITY_HINT[result.context_quality]}
            </span>
            <span className={styles.metaDot} />
            <span className={styles.confidence}>
              confianza {(result.confidence * 100).toFixed(0)}%
            </span>
          </div>

          <ol className={styles.steps}>
            {result.steps.map((s, i) => {
              const status = stepStatus[i] ?? 'pending';
              const isDone = status === 'done' || status === 'partial' || status === 'skipped';
              return (
                <li
                  key={i}
                  className={`${styles.step} ${isDone ? styles.stepDone : ''} ${
                    status === 'skipped' ? styles.stepSkipped : ''
                  }`}
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <div className={styles.stepHeader}>
                    <span className={styles.stepN}>
                      {(i + 1).toString().padStart(2, '0')}
                    </span>
                    <span className={styles.action}>{s.action}</span>
                    <span className={`${styles.effort} ${styles[`eff_${s.effort}`]}`}>
                      {EFFORT_LABEL[s.effort]}
                    </span>
                  </div>
                  <p className={styles.rationale}>{s.rationale}</p>
                  {s.depends_on && s.depends_on.length > 0 && (
                    <p className={styles.depends}>
                      Requiere antes:{' '}
                      {s.depends_on
                        .map((n) => (n + 1).toString().padStart(2, '0'))
                        .join(', ')}
                    </p>
                  )}

                  {status === 'pending' && (
                    <div className={styles.stepActions}>
                      <button
                        className={styles.actionDone}
                        onClick={() => openCompleteFlow(i, 'done')}
                      >
                        Hecho
                      </button>
                      <button
                        className={styles.actionPartial}
                        onClick={() => openCompleteFlow(i, 'partial')}
                      >
                        Parcial
                      </button>
                      <button
                        className={styles.actionSkip}
                        onClick={() => openCompleteFlow(i, 'skipped')}
                      >
                        Descartar
                      </button>
                    </div>
                  )}

                  {status === 'completing' && (
                    <p className={styles.completing}>guardando…</p>
                  )}

                  {isDone && (
                    <p className={`${styles.statusTag} ${styles[`tag_${status}`]}`}>
                      ✓ {STATUS_LABEL[status]}
                    </p>
                  )}

                  {activeNoteIdx === i && (
                    <div className={styles.noteDialog}>
                      <textarea
                        autoFocus
                        rows={2}
                        placeholder="¿Algún detalle que añadir? (opcional)"
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        className={styles.noteInput}
                      />
                      <div className={styles.noteActions}>
                        <button onClick={cancelNote} className={styles.noteCancel}>
                          Cancelar
                        </button>
                        <button onClick={confirmComplete} className={styles.noteConfirm}>
                          Guardar como{' '}
                          {STATUS_LABEL[pendingStatus].toLowerCase()}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>

          {result.blocking_questions.length > 0 && (
            <div className={styles.blockers}>
              <h3 className={styles.blockersTitle}>Preguntas que te desbloquearían</h3>
              <ul>
                {result.blocking_questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
