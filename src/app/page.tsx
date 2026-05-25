'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { InboxBadge } from '@/components/inbox/InboxBadge';
import { ChatInput } from '@/components/chat/ChatInput';
import { MessageList, type Message } from '@/components/chat/MessageList';
import { parsePdf } from '@/lib/ingestion/pdf';
import { parseXlsx } from '@/lib/ingestion/xlsx';
import { parseMarkdown } from '@/lib/ingestion/markdown';
import type { MemorySearchResult, SourceType } from '@/types/domain';
import { nanoid } from 'nanoid';
import styles from './page.module.css';

type Mode = 'capture' | 'search';

export default function HomePage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [mode, setMode] = useState<Mode>('capture');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: 999_999, behavior: 'smooth' });
  }, [messages]);

  function pushMessage(m: Message) {
    setMessages((prev) => [...prev, m]);
  }

  /** ============ CAPTURA TEXTO ============ */
  const handleTextCapture = useCallback(async (text: string) => {
    pushMessage({ id: nanoid(), kind: 'user_input', text });
    setBusy(true);
    try {
      const res = await fetch('/api/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_type: 'text', raw_text: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error);
      pushMessage({
        id: nanoid(),
        kind: 'system',
        text: data.summary,
        meta: `memoria guardada · confianza ${(data.confidence * 100).toFixed(0)}%`,
      });
    } catch (e) {
      pushMessage({ id: nanoid(), kind: 'error', text: String(e) });
    } finally {
      setBusy(false);
    }
  }, []);

  /** ============ CAPTURA ARCHIVOS ============ */
  const handleFileCapture = useCallback(async (file: File) => {
    const ext = file.name.toLowerCase().split('.').pop() || '';

    pushMessage({
      id: nanoid(),
      kind: 'user_input',
      text: `📎 ${file.name}`,
      meta: `${(file.size / 1024).toFixed(0)} KB`,
    });
    setBusy(true);

    try {
      let sourceType: SourceType;
      let rawText = '';
      let sourceMetadata: Record<string, unknown> = { filename: file.name, size: file.size };
      let sourceUri: string | undefined;

      if (ext === 'pdf') {
        sourceType = 'pdf';
        const parsed = await parsePdf(file);
        rawText = parsed.text;
        sourceMetadata = { ...sourceMetadata, ...parsed.metadata, page_count: parsed.page_count };
      } else if (ext === 'xlsx' || ext === 'xls') {
        sourceType = 'xlsx';
        const parsed = await parseXlsx(file);
        rawText = parsed.narrative;
        sourceMetadata = { ...sourceMetadata, ...parsed.metadata };
      } else if (ext === 'md' || ext === 'markdown' || ext === 'txt') {
        sourceType = ext === 'txt' ? 'text' : 'md';
        const parsed = await parseMarkdown(file);
        rawText = parsed.text;
        sourceMetadata = { ...sourceMetadata, frontmatter: parsed.frontmatter };
      } else if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
        sourceType = 'image';
        // Subir a Supabase Storage primero
        const supabase = createClient();
        const path = `${Date.now()}-${nanoid(8)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('lexis-raw')
          .upload(path, file);
        if (upErr) throw upErr;
        const { data: signed } = await supabase.storage
          .from('lexis-raw')
          .createSignedUrl(path, 60 * 60);
        sourceUri = signed?.signedUrl;
        rawText = '';
      } else {
        throw new Error(`Tipo de archivo no soportado: .${ext}`);
      }

      const res = await fetch('/api/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_type: sourceType,
          raw_text: rawText,
          source_uri: sourceUri,
          source_metadata: sourceMetadata,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error);
      pushMessage({
        id: nanoid(),
        kind: 'system',
        text: data.summary,
        meta: `memoria guardada · ${sourceType.toUpperCase()} · confianza ${(data.confidence * 100).toFixed(0)}%`,
      });
    } catch (e) {
      pushMessage({ id: nanoid(), kind: 'error', text: String(e) });
    } finally {
      setBusy(false);
    }
  }, []);

  /** ============ BÚSQUEDA ============ */
  const handleSearch = useCallback(async (query: string) => {
    pushMessage({ id: nanoid(), kind: 'user_input', text: query });
    setBusy(true);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, match_count: 8 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error);
      const results = data.results as MemorySearchResult[];
      pushMessage({
        id: nanoid(),
        kind: 'results',
        text: results.length ? `${results.length} memoria(s) encontradas` : 'Sin resultados',
        results,
      });
    } catch (e) {
      pushMessage({ id: nanoid(), kind: 'error', text: String(e) });
    } finally {
      setBusy(false);
    }
  }, []);

  async function handleSubmit(text: string, files: File[]) {
    if (files.length > 0) {
      for (const f of files) await handleFileCapture(f);
      if (text.trim()) await handleTextCapture(text);
    } else if (text.trim()) {
      if (mode === 'capture') await handleTextCapture(text);
      else await handleSearch(text);
    }
  }

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = '/auth/login';
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.dot} aria-hidden />
          <span className={styles.brandText}>Lexis</span>
        </div>
        <div className={styles.tabs}>
          <button
            onClick={() => setMode('capture')}
            className={mode === 'capture' ? styles.tabActive : styles.tab}
          >
            Capturar
          </button>
          <button
            onClick={() => setMode('search')}
            className={mode === 'search' ? styles.tabActive : styles.tab}
          >
            Buscar
          </button>
        </div>
        <div className={styles.headerRight}>
          <Link href="/feed" className={styles.navLinkFeed} title="Feed proactivo">
            ◈
          </Link>
          <Link href="/dashboard" className={styles.navLink} title="Dashboard">
            ⌬
          </Link>
          <Link href="/projects" className={styles.navLink} title="Proyectos">
            ✦
          </Link>
          <Link href="/entities" className={styles.navLink} title="Entidades">
            ◇
          </Link>
          <Link href="/timeline" className={styles.navLink} title="Timeline">
            ⌖
          </Link>
          <Link href="/interview" className={styles.navLink} title="Entrevista">
            ※
          </Link>
          <Link href="/import" className={styles.navLink} title="Importar">
            ⤓
          </Link>
          <Link href="/digest" className={styles.navLink} title="Digest periódico">
            ✉
          </Link>
          <InboxBadge />
          <Link href="/connectors" className={styles.navLink} title="Connectors">
            ⇲
          </Link>
          <Link href="/export" className={styles.navLink} title="Exportar grafo">
            ⤒
          </Link>
          <Link href="/settings/tokens" className={styles.navLink} title="Tokens API">
            ⚙
          </Link>
          <button onClick={logout} className={styles.logout} title="Cerrar sesión">
            ⏻
          </button>
        </div>
      </header>

      <div ref={listRef} className={styles.scroll}>
        <MessageList messages={messages} mode={mode} />
      </div>

      <ChatInput
        onSubmit={handleSubmit}
        disabled={busy}
        placeholder={
          mode === 'capture'
            ? 'Escribe lo que quieras recordar, o suelta un archivo…'
            : '¿Qué quieres recordar?'
        }
      />
    </main>
  );
}
