'use client';

import { useState, useEffect, useRef } from 'react';
import type { Filters, SourceType } from '@/lib/search/filters';
import styles from './SearchFilters.module.css';

interface ProjectOpt {
  id: string;
  name: string;
  slug?: string;
}
interface EntityOpt {
  id: string;
  name: string;
  entity_type: string;
}

interface Props {
  value: Filters;
  onChange: (next: Filters) => void;
  projects: ProjectOpt[];
  entities: EntityOpt[];
  /** Mostrar filtro de origen (default true) */
  showOrigins?: boolean;
}

const SOURCE_TYPE_OPTIONS: Array<{ value: SourceType; label: string; glyph: string }> = [
  { value: 'text', label: 'Texto', glyph: 'T' },
  { value: 'voice', label: 'Voz', glyph: '◉' },
  { value: 'image', label: 'Imagen', glyph: '▢' },
  { value: 'pdf', label: 'PDF', glyph: '▤' },
  { value: 'xlsx', label: 'Hoja', glyph: '▦' },
  { value: 'md', label: 'Markdown', glyph: '↳' },
  { value: 'url', label: 'URL', glyph: '⌘' },
];

const ORIGIN_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'capture', label: 'Captura manual' },
  { value: 'interview', label: 'Entrevista' },
  { value: 'batch_import', label: 'Importación masiva' },
  { value: 'next_step_completion', label: 'Pasos completados' },
];

const PRESET_RANGES: Array<{ label: string; days: number | null }> = [
  { label: 'Todo', days: null },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '1y', days: 365 },
];

export function SearchFilters({
  value,
  onChange,
  projects,
  entities,
  showOrigins = true,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [projQuery, setProjQuery] = useState('');
  const [entQuery, setEntQuery] = useState('');
  const projWrapRef = useRef<HTMLDivElement>(null);

  // ---------- helpers ----------

  const activeCount =
    (value.project_ids?.length || 0) +
    (value.entity_ids?.length || 0) +
    (value.source_types?.length || 0) +
    (value.origins?.length || 0) +
    (value.date_from || value.date_to ? 1 : 0);

  function toggleArray<T>(arr: T[] | undefined, item: T): T[] | undefined {
    const cur = arr || [];
    const next = cur.includes(item) ? cur.filter((x) => x !== item) : [...cur, item];
    return next.length ? next : undefined;
  }

  function applyPreset(days: number | null) {
    if (days === null) {
      onChange({ ...value, date_from: undefined, date_to: undefined });
      return;
    }
    const from = new Date(Date.now() - days * 86400_000).toISOString();
    onChange({ ...value, date_from: from, date_to: undefined });
  }

  function clearAll() {
    onChange({});
  }

  const filteredProjects = projects.filter((p) =>
    p.name.toLowerCase().includes(projQuery.toLowerCase())
  );
  const filteredEntities = entities.filter((e) =>
    e.name.toLowerCase().includes(entQuery.toLowerCase())
  );

  const selectedProjects = projects.filter((p) => value.project_ids?.includes(p.id));
  const selectedEntities = entities.filter((e) => value.entity_ids?.includes(e.id));

  // Cierre al click fuera
  useEffect(() => {
    if (!expanded) return;
    function onClick(ev: MouseEvent) {
      if (
        projWrapRef.current &&
        !projWrapRef.current.contains(ev.target as Node)
      ) {
        // no autocerrar, el user lo cierra con el toggle
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [expanded]);

  return (
    <div className={styles.wrap} ref={projWrapRef}>
      <div className={styles.toolbar}>
        <button
          className={`${styles.toggle} ${activeCount > 0 ? styles.toggleActive : ''}`}
          onClick={() => setExpanded((v) => !v)}
          type="button"
        >
          <span className={styles.toggleGlyph} aria-hidden>⫶</span>
          <span>Filtros</span>
          {activeCount > 0 && <span className={styles.toggleBadge}>{activeCount}</span>}
        </button>

        {/* Chips de selección actual (siempre visibles) */}
        {selectedProjects.slice(0, 3).map((p) => (
          <button
            key={p.id}
            className={styles.activeChip}
            onClick={() =>
              onChange({
                ...value,
                project_ids: toggleArray(value.project_ids, p.id),
              })
            }
            type="button"
            title={`Quitar filtro ${p.name}`}
          >
            ✦ {p.name}
            <span className={styles.chipX}>×</span>
          </button>
        ))}
        {selectedEntities.slice(0, 3).map((e) => (
          <button
            key={e.id}
            className={styles.activeChip}
            onClick={() =>
              onChange({
                ...value,
                entity_ids: toggleArray(value.entity_ids, e.id),
              })
            }
            type="button"
            title={`Quitar filtro ${e.name}`}
          >
            ◇ {e.name}
            <span className={styles.chipX}>×</span>
          </button>
        ))}
        {(selectedProjects.length > 3 || selectedEntities.length > 3) && (
          <span className={styles.moreHint}>
            +{Math.max(0, selectedProjects.length - 3) + Math.max(0, selectedEntities.length - 3)} más
          </span>
        )}

        {activeCount > 0 && (
          <button onClick={clearAll} className={styles.clearAll} type="button">
            limpiar
          </button>
        )}
      </div>

      {expanded && (
        <div className={styles.panel}>
          {/* Fechas */}
          <div className={styles.section}>
            <h4 className={styles.sectionTitle}>Periodo</h4>
            <div className={styles.presetRow}>
              {PRESET_RANGES.map((r) => {
                const isActive =
                  (r.days === null && !value.date_from) ||
                  (r.days !== null &&
                    value.date_from &&
                    Math.abs(
                      new Date(value.date_from).getTime() -
                        (Date.now() - r.days * 86400_000)
                    ) <
                      86400_000);
                return (
                  <button
                    key={r.label}
                    onClick={() => applyPreset(r.days)}
                    className={`${styles.preset} ${isActive ? styles.presetActive : ''}`}
                    type="button"
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Proyectos */}
          <div className={styles.section}>
            <h4 className={styles.sectionTitle}>
              Proyectos
              {value.project_ids?.length ? (
                <span className={styles.countTag}>{value.project_ids.length}</span>
              ) : null}
            </h4>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Buscar proyecto…"
              value={projQuery}
              onChange={(e) => setProjQuery(e.target.value)}
            />
            <div className={styles.optionList}>
              {filteredProjects.slice(0, 16).map((p) => {
                const checked = value.project_ids?.includes(p.id) ?? false;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`${styles.option} ${checked ? styles.optionChecked : ''}`}
                    onClick={() =>
                      onChange({
                        ...value,
                        project_ids: toggleArray(value.project_ids, p.id),
                      })
                    }
                  >
                    <span className={styles.checkbox}>{checked ? '●' : ''}</span>
                    {p.name}
                  </button>
                );
              })}
              {filteredProjects.length === 0 && (
                <p className={styles.noResults}>Sin resultados</p>
              )}
            </div>
          </div>

          {/* Entidades */}
          <div className={styles.section}>
            <h4 className={styles.sectionTitle}>
              Entidades
              {value.entity_ids?.length ? (
                <span className={styles.countTag}>{value.entity_ids.length}</span>
              ) : null}
            </h4>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Buscar entidad…"
              value={entQuery}
              onChange={(e) => setEntQuery(e.target.value)}
            />
            <div className={styles.optionList}>
              {filteredEntities.slice(0, 16).map((e) => {
                const checked = value.entity_ids?.includes(e.id) ?? false;
                return (
                  <button
                    key={e.id}
                    type="button"
                    className={`${styles.option} ${checked ? styles.optionChecked : ''}`}
                    onClick={() =>
                      onChange({
                        ...value,
                        entity_ids: toggleArray(value.entity_ids, e.id),
                      })
                    }
                  >
                    <span className={styles.checkbox}>{checked ? '●' : ''}</span>
                    {e.name}
                    <span className={styles.entityType}>{e.entity_type}</span>
                  </button>
                );
              })}
              {filteredEntities.length === 0 && (
                <p className={styles.noResults}>Sin resultados</p>
              )}
            </div>
          </div>

          {/* Tipos de fuente */}
          <div className={styles.section}>
            <h4 className={styles.sectionTitle}>Tipo de fuente</h4>
            <div className={styles.sourceRow}>
              {SOURCE_TYPE_OPTIONS.map((opt) => {
                const checked = value.source_types?.includes(opt.value) ?? false;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    className={`${styles.sourceChip} ${checked ? styles.sourceActive : ''}`}
                    onClick={() =>
                      onChange({
                        ...value,
                        source_types: toggleArray(value.source_types, opt.value),
                      })
                    }
                  >
                    <span className={styles.sourceGlyph}>{opt.glyph}</span>
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Origen */}
          {showOrigins && (
            <div className={styles.section}>
              <h4 className={styles.sectionTitle}>Origen</h4>
              <div className={styles.sourceRow}>
                {ORIGIN_OPTIONS.map((opt) => {
                  const checked = value.origins?.includes(opt.value) ?? false;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      className={`${styles.originChip} ${checked ? styles.originActive : ''}`}
                      onClick={() =>
                        onChange({
                          ...value,
                          origins: toggleArray(value.origins, opt.value),
                        })
                      }
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
