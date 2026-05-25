'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './login.module.css';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setStatus('sending');
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setStatus('error');
      setError(error.message);
    } else {
      setStatus('sent');
    }
  }

  return (
    <main className={styles.main}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.dot} aria-hidden />
          <span className={styles.brandText}>Lexis</span>
        </div>

        <h1 className={styles.title}>
          Tu memoria,
          <br />
          <span className={styles.gradient}>amplificada.</span>
        </h1>

        <p className={styles.subtitle}>
          Introduce tu email. Te enviaremos un enlace mágico para entrar.
        </p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="tu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={styles.input}
            disabled={status === 'sending' || status === 'sent'}
          />
          <button
            type="submit"
            className={styles.button}
            disabled={status === 'sending' || status === 'sent' || !email}
          >
            {status === 'sending' && 'Enviando…'}
            {status === 'sent' && 'Revisa tu email →'}
            {(status === 'idle' || status === 'error') && 'Enviar enlace'}
          </button>
        </form>

        {status === 'sent' && (
          <p className={styles.success}>
            Si el email existe, recibirás un enlace en unos segundos.
          </p>
        )}
        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.footer}>
          <span>v0.1 · Sprint 1</span>
        </div>
      </div>
    </main>
  );
}
