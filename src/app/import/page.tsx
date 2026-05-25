'use client';

import { useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { parsePdf } from '@/lib/ingestion/pdf';
import { parseXlsx } from '@/lib/ingestion/xlsx';
import { parseMarkdown } from '@/lib/ingestion/markdown';
import { parseWhatsApp } from '@/lib/import/whatsapp';
import { nanoid } from 'nanoid';
import styles from './page.module.css';

type FileStatus = 'pending' | 'parsing' | 'queued' | 'ok' | 'failed';

interface FileItem {
  id: string;
  name: string;
  size: number;
  kind: 'pdf' | 'xlsx' | 'md' | 'txt' | 'image' | 'whatsapp' | 'unknown';
  status: FileStatus;
  detail?: string;
  // Items que producirá este archivo cuando se mande al backend
  payloads?: Array<{ raw_text: string; source_type: string; source_uri?: string; label: string }>;
  results?: Array<{ status: 'ok' | 'failed'; decision?: string; error?: string }>;
}

const ACCEPT =
  '.pdf,.xlsx,.xls,.md,.markdown,.txt,.png,.jpg,.jpeg,.webp';

function classifyFile(file: File): FileItem['kind'] {
  const n = file.name.toLowerCase();
  if (n.endsWith('.pdf')) return 'pdf';
  if (n.endsWith('.xlsx') || n.endsWith('.xls')) return 'xlsx';
  if (n.endsWith('.md') || n.endsWith('.markdown')) return 'md';
  if (n.endsWith('.png') || n.endsWith('.jpg') || n.endsWith('.jpeg') || n.endsWith('.webp')) return 'image';
  if (n.endsWith('.txt')) {
    // Detección heurística WhatsApp: nombre típico
    if (/whatsapp|chat with|conversaci[oó]n/i.test(file.name)) return 'whatsapp';
    return 'txt';
  }
  return 'unknown';
}

export default function ImportPage() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<{
    total: number;
    ok: number;
    failed: number;
    redundant: number;
    modifications: number;
    new_memories: number;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function addFiles(list: FileList | File[]) {
    const arr = Array.from(list);
    setFiles((prev) => [
      ...prev,
      ...arr.map((f) => ({
        id: nanoid(),
        name: f.name,
        size: f.size,
        kind: classifyFile(f),
        status: 'pending' as FileStatus,
        // Guardamos el File en una propiedad ad-hoc (no se serializa al API)
        _file: f,
      })) as FileItem[],
    ]);
    setSummary(null);
  }

  async function parseFile(item: FileItem & { _file: File }) {
    const file = item._file;
    const payloads: FileItem['payloads'] = [];

    if (item.kind === 'pdf') {
      const r = await parsePdf(file);
      payloads.push({
        raw_text: r.text,
        source_type: 'pdf',
        label: file.name,
      });
    } else if (item.kind === 'xlsx') {
      const r = await parseXlsx(file);
      payloads.push({
        raw_text: r.narrative,
        source_type: 'xlsx',
        label: file.name,
      });
    } else if (item.kind === 'md') {
      const r = await parseMarkdown(file);
      payloads.push({
        raw_text: r.text,
        source_type: 'md',
        label: file.name,
      });
    } else if (item.kind === 'txt') {
      const text = await file.text();
      payloads.push({
        raw_text: text,
        source_type: 'text',
        label: file.name,
      });
    } else if (item.kind === 'whatsapp') {
      const wa = await parseWhatsApp(file);
      for (const block of wa.blocks) {
        payloads.push({
          raw_text: block.text,
          source_type: 'text',
          label: block.title,
        });
      }
    } else if (item.kind === 'image') {
      const supabase = createClient();
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const path = `import-${Date.now()}-${nanoid(6)}.${ext}`;
      const { error: upErr } = await supabase.storage.from('lexis-raw').upload(path, file);
      if (upErr) throw upErr;
      const { data: signed } = await supabase.storage
        .from('lexis-raw')
        .createSignedUrl(path, 60 * 60);
      payloads.push({
        raw_text: '',
        source_type: 'image',
        source_uri: signed?.signedUrl,
        label: file.name,
      });
    } else {
      throw new Error(`Tipo no soportado: ${file.name}`);
    }

    return payloads;
  }

  async function runImport() {
    if (running || !files.length) return;
    setRunning(true);
    setSummary(null);

    let totalOk = 0;
    let totalFailed = 0;
    let totalRedundant = 0;
    let totalMods = 0;
    let totalCount = 0;

    // Paso 1: parsear cada archivo client-side
    const allPayloads: Array<{
      fileId: string;
      payload: NonNullable<FileItem['payloads']>[number];
    }> = [];

    for (const f of files) {
      if (f.status === 'ok') continue;
      setFiles((prev) =>
        prev.map((it) =>
          it.id === f.id ? { ...it, status: 'parsing', detail: 'parseando…' } : it
        )
      );
      try {
        const payloads = await parseFile(f as any);
        allPayloads.push(...payloads.map((p) => ({ fileId: f.id, payload: p })));
        setFiles((prev) =>
          prev.map((it) =>
            it.id === f.id
              ? {
                  ...it,
                  status: 'queued',
                  detail: `${payloads.length} bloque(s) listo(s)`,
                  payloads,
                }
              : it
          )
        );
      } catch (e) {
        setFiles((prev) =>
          prev.map((it) =>
            it.id === f.id
              ? { ...it, status: 'failed', detail: String(e).slice(0, 120) }
              : it
          )
        );
        totalFailed++;
      }
    }

    // Paso 2: enviar en lotes de 20 al backend
    const CHUNK = 20;
    for (let i = 0; i < allPayloads.length; i += CHUNK) {
      const slice = allPayloads.slice(i, i + CHUNK);
      try {
        const res = await fetch('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: slice.map((s) => s.payload),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || data.error);
        totalOk += data.ok;
        totalFailed += data.failed;
        totalRedundant += data.redundant;
        totalMods += data.modifications;
        totalCount += data.total;

        // Imprimir status por archivo: el primer fileId del slice gana el resultado
        // (mejor: estado del último envío)
        for (let j = 0; j < slice.length; j++) {
          const fileId = slice[j].fileId;
          const r = data.results?.[j];
          setFiles((prev) =>
            prev.map((it) => {
              if (it.id !== fileId) return it;
              const prevResults = it.results ?? [];
              prevResults.push({
                status: r?.status ?? 'failed',
                decision: r?.decision,
                error: r?.error,
              });
              const failed = prevResults.some((rr) => rr.status === 'failed');
              return {
                ...it,
                results: prevResults,
                status: failed ? 'failed' : 'ok',
                detail: failed
                  ? prevResults.find((rr) => rr.error)?.error?.slice(0, 120) || 'fallo'
                  : `${prevResults.length} bloque(s) procesado(s)`,
              };
            })
          );
        }
      } catch (e) {
        const errStr = String(e).slice(0, 120);
        for (const s of slice) {
          setFiles((prev) =>
            prev.map((it) =>
              it.id === s.fileId ? { ...it, status: 'failed', detail: errStr } : it
            )
          );
          totalFailed++;
        }
      }
    }

    setSummary({
      total: totalCount,
      ok: totalOk,
      failed: totalFailed,
      redundant: totalRedundant,
      modifications: totalMods,
      new_memories: totalOk - totalRedundant,
    });
    setRunning(false);
  }

  function clearAll() {
    setFiles([]);
    setSummary(null);
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  }, []);

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}>
          ← Chat
        </Link>
        <h1 className={styles.title}>
          <span className={styles.titleAccent}>importar</span>
        </h1>
        <div />
      </header>

      <div className={styles.content}>
        <p className={styles.intro}>
          Suelta archivos PDF, hojas de cálculo, notas Markdown, imágenes, .txt
          o exports de WhatsApp. Se procesarán uno a uno con el pipeline
          completo: resumen, clasificación, asignación a proyectos y entidades.
        </p>

        <div
          className={`${styles.drop} ${dragging ? styles.dropActive : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
        >
          <div className={styles.dropHalo} aria-hidden />
          <div className={styles.dropGlyph}>⤓</div>
          <p className={styles.dropText}>
            {dragging ? 'Suelta para añadir' : 'Arrastra archivos aquí o clic para elegir'}
          </p>
          <p className={styles.dropHint}>
            PDF · XLSX · MD · TXT · WhatsApp export · imágenes
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        {files.length > 0 && (
          <section className={styles.fileList}>
            <header className={styles.fileListHead}>
              <h2 className={styles.fileListTitle}>
                {files.length} archivo{files.length === 1 ? '' : 's'} en cola
              </h2>
              <div className={styles.actions}>
                <button onClick={clearAll} disabled={running} className={styles.secondary}>
                  Limpiar
                </button>
                <button onClick={runImport} disabled={running} className={styles.primary}>
                  {running ? 'Procesando…' : 'Importar'}
                </button>
              </div>
            </header>

            {running && (
              <div className={styles.progressBar} role="progressbar">
                <div
                  className={styles.progressFill}
                  style={{
                    width: `${
                      files.length
                        ? (files.filter((f) => f.status === 'ok' || f.status === 'failed').length /
                            files.length) *
                          100
                        : 0
                    }%`,
                  }}
                />
                <span className={styles.progressLabel}>
                  {files.filter((f) => f.status === 'ok' || f.status === 'failed').length} /{' '}
                  {files.length} procesados
                </span>
              </div>
            )}

            <div className={styles.items}>
              {files.map((f) => (
                <div key={f.id} className={`${styles.item} ${styles[`it_${f.status}`]}`}>
                  <div className={styles.itemMeta}>
                    <span className={styles.itemKind}>{f.kind}</span>
                    <span className={styles.itemName}>{f.name}</span>
                    <span className={styles.itemSize}>
                      {(f.size / 1024).toFixed(0)} KB
                    </span>
                  </div>
                  <div className={styles.itemStatus}>
                    {f.status === 'pending' && <span>pendiente</span>}
                    {f.status === 'parsing' && (
                      <span className={styles.statBusy}>parseando…</span>
                    )}
                    {f.status === 'queued' && (
                      <span className={styles.statQueued}>{f.detail}</span>
                    )}
                    {f.status === 'ok' && (
                      <span className={styles.statOk}>✓ {f.detail}</span>
                    )}
                    {f.status === 'failed' && (
                      <span className={styles.statErr}>✗ {f.detail}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {summary && (
          <section className={styles.summary}>
            <h2 className={styles.summaryTitle}>Resumen</h2>
            <div className={styles.summaryGrid}>
              <Stat label="Bloques procesados" value={summary.total} accent />
              <Stat label="Memorias nuevas" value={summary.new_memories} />
              <Stat label="Modificaciones" value={summary.modifications} />
              <Stat label="Redundantes" value={summary.redundant} />
              <Stat label="Errores" value={summary.failed} danger />
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
  accent,
  danger,
}: {
  label: string;
  value: number;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      className={`${styles.stat} ${accent ? styles.statAccent : ''} ${
        danger ? styles.statDanger : ''
      }`}
    >
      <span className={styles.statN}>{value}</span>
      <span className={styles.statL}>{label}</span>
    </div>
  );
}
