'use client';

// =====================================================
// Entrada a Lexis (L-07, 2026-10-20)
//
// Por defecto: email + CÓDIGO numérico (8 cifras en este proyecto; la
// longitud la fija Supabase → Auth → Email OTP Length). Sin contraseñas que recordar y sin
// depender de abrir un enlace en el mismo navegador (el enlace del correo se
// abría en otra app y la sesión no quedaba en la de Lexis).
//   1. «Enviarme un código» → Supabase manda el correo (signInWithOtp).
//   2. Se escribe el código → verifyOtp. Sesión persistente en el teléfono.
// El código también puede generarlo Javi (_scripts/codigo_entrada.mjs) y
// dárselo por teléfono si el correo corporativo se come el email.
// «Tengo una contraseña» mantiene la entrada clásica.
// =====================================================

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import styles from './login.module.css';

type Modo = 'codigo' | 'password';
type Paso = 'email' | 'codigo';

function errorLlano(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('invalid login credentials')) return 'El email o la contraseña no son correctos.';
  if (m.includes('expired') || m.includes('invalid') || m.includes('otp'))
    return 'Ese código no vale o ha caducado. Pide uno nuevo.';
  if (m.includes('rate limit') || m.includes('security purposes') || m.includes('too many'))
    return 'Has pedido varios códigos seguidos. Espera un minuto y vuelve a probar.';
  if (m.includes('signups not allowed') || m.includes('user not found'))
    return 'Ese email no tiene acceso a Lexis. Revisa que esté bien escrito.';
  if (m.includes('fetch') || m.includes('network')) return 'No hay conexión. Revisa la cobertura o el wifi.';
  return 'No he podido completar la entrada. Vuelve a intentarlo.';
}

/** Solo rutas internas («/asistente»), nunca a otro dominio. */
function destinoSeguro(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

function Login() {
  const params = useSearchParams();
  const destino = destinoSeguro(params.get('next'));
  const [modo, setModo] = useState<Modo>('codigo');
  const [paso, setPaso] = useState<Paso>('email');
  const [email, setEmail] = useState('');
  const [codigo, setCodigo] = useState('');
  const [password, setPassword] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get('error') ? 'El enlace del correo ha caducado o ya se usó. Pide un código nuevo.' : null
  );
  const [aviso, setAviso] = useState<string | null>(null);
  const [esperaReenvio, setEsperaReenvio] = useState(0);
  const [ayuda, setAyuda] = useState(false);

  // El email se recuerda en el teléfono: al volver a entrar ya está escrito.
  useEffect(() => {
    try {
      const guardado = localStorage.getItem('lexis_email');
      if (guardado) setEmail(guardado);
    } catch {
      // sin almacenamiento
    }
  }, []);

  function recordarEmail() {
    try {
      localStorage.setItem('lexis_email', email.trim());
    } catch {
      // sin almacenamiento
    }
  }

  useEffect(() => {
    if (esperaReenvio <= 0) return;
    const t = setTimeout(() => setEsperaReenvio((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [esperaReenvio]);

  async function enviarCodigo() {
    if (!email.trim()) return;
    setOcupado(true);
    setError(null);
    setAviso(null);
    const { error } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: {
        // Nunca da de alta cuentas nuevas: el alta es siempre administrada.
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(destino)}`,
      },
    });
    setOcupado(false);
    if (error) {
      setError(errorLlano(error.message));
      return;
    }
    setPaso('codigo');
    setEsperaReenvio(60);
    setAviso(`Te he enviado un código a ${email.trim()}.`);
  }

  async function entrarConCodigo() {
    const token = codigo.replace(/\D/g, '');
    if (!email.trim() || token.length < 6) return;
    setOcupado(true);
    setError(null);
    const supabase = createClient();
    // 'email' es el tipo actual; 'magiclink' cubre códigos generados como enlace.
    let { error } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: 'email' });
    if (error) {
      ({ error } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: 'magiclink' }));
    }
    if (error) {
      setOcupado(false);
      setError(errorLlano(error.message));
      return;
    }
    recordarEmail();
    window.location.href = destino;
  }

  async function entrarConPassword() {
    if (!email.trim() || !password) return;
    setOcupado(true);
    setError(null);
    const { error } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setOcupado(false);
      setError(errorLlano(error.message));
      return;
    }
    recordarEmail();
    window.location.href = destino;
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (modo === 'password') entrarConPassword();
    else if (paso === 'email') enviarCodigo();
    else entrarConCodigo();
  }

  const enlace: React.CSSProperties = {
    background: 'none',
    border: 'none',
    padding: '10px 0',
    minHeight: 44,
    fontSize: 15.5,
    color: 'var(--fg-1, #c8cfe0)',
    textDecoration: 'underline',
    cursor: 'pointer',
    textAlign: 'left',
  };

  return (
    <main className={styles.main}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.dot} aria-hidden />
          <span className={styles.brandText}>Lexis</span>
        </div>

        <h1 className={styles.title}>Entrar</h1>

        <p className={styles.subtitle} style={{ fontSize: 16 }}>
          {modo === 'password'
            ? 'Escribe tu email y tu contraseña.'
            : paso === 'email'
              ? 'Escribe tu email y te mando un código para entrar.'
              : 'Escribe el código que te ha llegado por correo.'}
        </p>

        <form onSubmit={onSubmit} className={styles.form}>
          <input
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            name="email"
            placeholder="tu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={styles.input}
            style={{ fontSize: 17 }}
            disabled={ocupado || (modo === 'codigo' && paso === 'codigo')}
          />

          {modo === 'codigo' && paso === 'codigo' && (
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              maxLength={10}
              name="codigo"
              placeholder="12345678"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              className={styles.input}
              style={{ fontSize: 24, letterSpacing: '0.3em', textAlign: 'center' }}
              autoFocus
              disabled={ocupado}
            />
          )}

          {modo === 'password' && (
            <input
              type="password"
              required
              autoComplete="current-password"
              name="password"
              placeholder="Tu contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={styles.input}
              style={{ fontSize: 17 }}
              disabled={ocupado}
            />
          )}

          <button
            type="submit"
            className={styles.button}
            style={{ minHeight: 48, fontSize: 17 }}
            disabled={
              ocupado ||
              !email.trim() ||
              (modo === 'password' && !password) ||
              (modo === 'codigo' && paso === 'codigo' && codigo.replace(/\D/g, '').length < 6)
            }
          >
            {ocupado
              ? 'Un momento…'
              : modo === 'password'
                ? 'Entrar'
                : paso === 'email'
                  ? 'Enviarme un código'
                  : 'Entrar'}
          </button>
        </form>

        {aviso && !error && <p className={styles.success}>{aviso}</p>}
        {error && <p className={styles.error}>{error}</p>}

        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 10 }}>
          {modo === 'codigo' && paso === 'email' && (
            <button type="button" style={enlace} onClick={() => (email.trim() ? setPaso('codigo') : setError('Escribe primero tu email.'))}>
              Ya tengo un código
            </button>
          )}
          {modo === 'codigo' && paso === 'codigo' && (
            <>
              <button
                type="button"
                style={{ ...enlace, opacity: esperaReenvio > 0 ? 0.6 : 1 }}
                disabled={esperaReenvio > 0 || ocupado}
                onClick={enviarCodigo}
              >
                {esperaReenvio > 0 ? `Enviar otro código (en ${esperaReenvio} s)` : 'Enviar otro código'}
              </button>
              <button type="button" style={enlace} onClick={() => setAyuda((v) => !v)}>
                No me llega el correo
              </button>
              {ayuda && (
                <p className={styles.subtitle} style={{ fontSize: 15, marginTop: 4 }}>
                  Mira en la carpeta de correo no deseado. Si en un par de minutos no está, pide el código a
                  Javi y escríbelo aquí.
                </p>
              )}
              <button
                type="button"
                style={enlace}
                onClick={() => {
                  setPaso('email');
                  setCodigo('');
                  setAviso(null);
                  setError(null);
                }}
              >
                Cambiar el email
              </button>
            </>
          )}
          <button
            type="button"
            style={enlace}
            onClick={() => {
              setModo(modo === 'password' ? 'codigo' : 'password');
              setError(null);
              setAviso(null);
            }}
          >
            {modo === 'password' ? 'Entrar con un código' : 'Tengo una contraseña'}
          </button>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  // useSearchParams exige un límite de Suspense en páginas cliente.
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}
