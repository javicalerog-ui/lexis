'use client';

import { useRef, useState, useCallback } from 'react';
import { VoiceRecorder } from '@/components/audio/VoiceRecorder';
import styles from './ChatInput.module.css';

interface Props {
  onSubmit: (text: string, files: File[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function ChatInput({ onSubmit, placeholder, disabled }: Props) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  function autosize() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }

  function submit() {
    if (disabled || (!text.trim() && !files.length)) return;
    onSubmit(text, files);
    setText('');
    setFiles([]);
    if (taRef.current) taRef.current.style.height = 'auto';
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length) setFiles((prev) => [...prev, ...dropped]);
  }, []);

  return (
    <div
      className={`${styles.wrap} ${dragging ? styles.dragging : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {files.length > 0 && (
        <div className={styles.attachments}>
          {files.map((f, i) => (
            <div key={i} className={styles.chip}>
              <span className={styles.chipName}>{f.name}</span>
              <button
                onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                className={styles.chipClose}
                aria-label="Quitar"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={styles.row}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          aria-label="Adjuntar archivo"
          title="Adjuntar"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>

        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept=".pdf,.xlsx,.xls,.md,.markdown,.txt,.png,.jpg,.jpeg,.webp,.gif"
          onChange={(e) => {
            const list = Array.from(e.target.files || []);
            if (list.length) setFiles((prev) => [...prev, ...list]);
            e.target.value = '';
          }}
        />

        <textarea
          ref={taRef}
          rows={1}
          placeholder={placeholder || 'Escribe…'}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            autosize();
          }}
          onKeyDown={handleKey}
          className={styles.ta}
        />

        <div className={styles.voiceSlot}>
          <VoiceRecorder
            disabled={disabled}
            reviewBeforeSubmit={false}
            onTranscript={(transcribed) => {
              setText((prev) => (prev ? `${prev} ${transcribed}` : transcribed));
              setTimeout(autosize, 0);
              taRef.current?.focus();
            }}
          />
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={disabled || (!text.trim() && !files.length)}
          className={styles.send}
          aria-label="Enviar"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
