'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './login.module.css';

type Mode = 'password' | 'magic';

// Traduce los errores más comunes de Supabase a algo humano.
function humanError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('invalid login credentials')) {
    return 'Email o contraseña incorrectos. ¿Aún no tienes contraseña? Entra con el enlace mágico y créala en Ajustes.';
  }
  if (m.includes('email not confirmed')) return 'Confirma tu email primero (revisa el enlace que te enviamos).';
  if (m.includes('rate limit')) return 'Demasiados intentos. Espera un momento y reinténtalo.';
  return msg;
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('sending');
    setError(null);
    const supabase = createClient();

    if (mode === 'magic') {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) {
        setStatus('error');
        setError(humanError(error.message));
      } else {
        setStatus('sent');
      }
      return;
    }

    // Contraseña
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      setStatus('error');
      setError(humanError(error.message));
    } else {
      // Sesión persistente: no habrá que volver a entrar en este dispositivo.
      window.location.href = '/';
    }
  }

  const busy = status === 'sending' || status === 'sent';

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
          {mode === 'password'
            ? 'Entra con tu email y contraseña.'
            : 'Introduce tu email y te enviaremos un enlace mágico para entrar.'}
        </p>

        {/* Selector de método */}
        <div
          role="tablist"
          aria-label="Método de acceso"
          style={{
            display: 'flex',
            gap: 6,
            padding: 4,
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 12,
            marginBottom: 18,
          }}
        >
          {(['password', 'magic'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                setStatus('idle');
                setError(null);
              }}
              style={{
                flex: 1,
                padding: '8px 10px',
                borderRadius: 9,
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                color: mode === m ? '#fff' : 'var(--fg-2, #aab2c8)',
                background:
                  mode === m
                    ? 'linear-gradient(100deg, #7c5cff, #56c7f0)'
                    : 'transparent',
              }}
            >
              {m === 'password' ? 'Contraseña' : 'Enlace mágico'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <input
            type="email"
            required
            autoComplete="email"
            name="email"
            placeholder="tu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={styles.input}
            disabled={busy}
          />
          {mode === 'password' && (
            <input
              type="password"
              required
              autoComplete="current-password"
              name="password"
              placeholder="Tu contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={styles.input}
              disabled={busy}
            />
          )}
          <button
            type="submit"
            className={styles.button}
            disabled={busy || !email || (mode === 'password' && !password)}
          >
            {status === 'sending' && (mode === 'magic' ? 'Enviando…' : 'Entrando…')}
            {status === 'sent' && 'Revisa tu email →'}
            {(status === 'idle' || status === 'error') &&
              (mode === 'magic' ? 'Enviar enlace' : 'Entrar')}
          </button>
        </form>

        {status === 'sent' && (
          <p className={styles.success}>
            Si el email existe, recibirás un enlace en unos segundos.
          </p>
        )}
        {error && <p className={styles.error}>{error}</p>}

        {mode === 'password' && (
          <p className={styles.subtitle} style={{ marginTop: 14, fontSize: 12.5 }}>
            ¿Primera vez o sin contraseña? Entra con el <b>enlace mágico</b> y créala
            en <b>Ajustes → Contraseña</b>.
          </p>
        )}

        <div className={styles.footer}>
          <span>v0.1 · Sprint 1</span>
        </div>
      </div>
    </main>
  );
}
