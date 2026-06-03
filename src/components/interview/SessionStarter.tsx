'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './SessionStarter.module.css';

type FocusType = 'open' | 'project' | 'entity';

interface ProjectOpt {
  id: string;
  name: string;
  slug: string;
}
interface EntityOpt {
  id: string;
  name: string;
  entity_type: string;
}

interface Props {
  projects: ProjectOpt[];
  entities: EntityOpt[];
}

export function SessionStarter({ projects, entities }: Props) {
  const router = useRouter();
  const [focusType, setFocusType] = useState<FocusType>('open');
  const [focusId, setFocusId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const payload: any = { focus_type: focusType };
      if (focusType !== 'open') {
        if (!focusId) {
          setError('Selecciona un proyecto o entidad.');
          setBusy(false);
          return;
        }
        payload.focus_id = focusId;
      }
      // NO migrado a fetchJson: este endpoint puede devolver un status no-ok
      // pero con session_id válido (se navega igualmente), así que necesitamos
      // el body aun con !res.ok. Parseamos defensivamente para no reventar con
      // "Unexpected token '<'" si llega HTML de error de plataforma.
      const res = await fetch('/api/interview/start', {
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
      if (!res.ok && !data.session_id) {
        throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      }
      router.push(`/interview/${data.session_id}`);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  return (
    <section className={styles.starter}>
      <header className={styles.head}>
        <span className={styles.glyph} aria-hidden>※</span>
        <div>
          <h2 className={styles.title}>Empezar una entrevista</h2>
          <p className={styles.sub}>
            Lexis te hace preguntas guiadas para extraer lo que sabes y enriquecer tu grafo.
          </p>
        </div>
      </header>

      <div className={styles.focusTabs}>
        <button
          className={focusType === 'open' ? styles.tabActive : styles.tab}
          onClick={() => {
            setFocusType('open');
            setFocusId('');
          }}
        >
          Exploratoria
        </button>
        <button
          className={focusType === 'project' ? styles.tabActive : styles.tab}
          onClick={() => {
            setFocusType('project');
            setFocusId('');
          }}
        >
          Sobre un proyecto
        </button>
        <button
          className={focusType === 'entity' ? styles.tabActive : styles.tab}
          onClick={() => {
            setFocusType('entity');
            setFocusId('');
          }}
        >
          Sobre alguien
        </button>
      </div>

      {focusType === 'project' && (
        <select
          className={styles.select}
          value={focusId}
          onChange={(e) => setFocusId(e.target.value)}
        >
          <option value="">Elige un proyecto…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}

      {focusType === 'entity' && (
        <select
          className={styles.select}
          value={focusId}
          onChange={(e) => setFocusId(e.target.value)}
        >
          <option value="">Elige una entidad…</option>
          {entities.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} · {e.entity_type}
            </option>
          ))}
        </select>
      )}

      {error && <p className={styles.error}>{error}</p>}

      <button onClick={start} disabled={busy} className={styles.startButton}>
        {busy ? 'Preparando…' : 'Empezar'}
      </button>
    </section>
  );
}
