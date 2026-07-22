'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import styles from './page.module.css';

export default function PasswordSettingsPage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('Las dos contraseñas no coinciden.');
      return;
    }
    setStatus('saving');
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setStatus('error');
      setError(error.message);
    } else {
      setStatus('saved');
      setPassword('');
      setConfirm('');
    }
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}>
          ← Chat
        </Link>
        <h1 className={styles.title}>
          <span className={styles.titleAccent}>contraseña</span>
        </h1>
        <div />
      </header>

      <div className={styles.content}>
        <p className={styles.intro}>
          Crea una contraseña para entrar sin depender del enlace mágico. Una vez
          guardada, tu navegador te ofrecerá recordarla y entrarás con un toque.
        </p>

        <form onSubmit={handleSubmit} className={styles.form}>
          {/* Campo email oculto: ayuda al gestor de contraseñas a asociar la
              credencial con tu cuenta al guardarla. */}
          <input type="email" name="email" autoComplete="username" style={{ display: 'none' }} readOnly value="" />
          <label className={styles.label}>
            Nueva contraseña
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={styles.input}
              placeholder="Mínimo 8 caracteres"
              required
            />
          </label>
          <label className={styles.label}>
            Repítela
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={styles.input}
              placeholder="Otra vez"
              required
            />
          </label>
          <button
            type="submit"
            className={styles.button}
            disabled={status === 'saving' || !password || !confirm}
          >
            {status === 'saving' ? 'Guardando…' : 'Guardar contraseña'}
          </button>
        </form>

        {status === 'saved' && (
          <p className={styles.success}>
            ✓ Contraseña guardada. La próxima vez entra con «Contraseña» en la
            pantalla de acceso.
          </p>
        )}
        {error && <p className={styles.error}>{error}</p>}
      </div>
    </main>
  );
}
