import Link from 'next/link';
import styles from './page.module.css';

export const runtime = 'nodejs';

interface PageProps {
  searchParams: { code?: string; detail?: string };
}

const ERROR_MESSAGES: Record<string, string> = {
  google_denied: 'Cancelaste la autorización en Google.',
  missing_params: 'Faltan parámetros en la respuesta de Google.',
  state_mismatch: 'La cookie de seguridad no coincide. Vuelve a empezar.',
  invalid_state: 'El state recibido no es válido o ha caducado (>10min).',
  no_session: 'Tu sesión expiró. Vuelve a iniciar sesión.',
  user_mismatch: 'La sesión actual no coincide con quien inició el flow.',
  token_exchange_failed: 'Google rechazó el intercambio de código por tokens.',
  userinfo_failed: 'No pudimos leer tu email de Google.',
  credentials_not_found: 'La credential que querías actualizar ya no existe.',
  persist_failed: 'No pudimos guardar los tokens en la base de datos.',
};

export default function OAuthErrorPage({ searchParams }: PageProps) {
  const code = searchParams.code || 'unknown';
  const message = ERROR_MESSAGES[code] || 'Error desconocido durante OAuth.';
  const detail = searchParams.detail;

  return (
    <main className={styles.main}>
      <div className={styles.card}>
        <span className={styles.glyph}>×</span>
        <h1 className={styles.title}>OAuth con Google falló</h1>
        <p className={styles.message}>{message}</p>
        {detail && (
          <details className={styles.detailWrap}>
            <summary className={styles.detailHead}>Detalle técnico</summary>
            <pre className={styles.detail}>{detail}</pre>
          </details>
        )}
        <code className={styles.code}>código: {code}</code>
        <div className={styles.actions}>
          <Link href="/connectors/new" className={styles.btnPrimary}>
            Volver a intentarlo
          </Link>
          <Link href="/connectors" className={styles.btnGhost}>
            Lista de connectors
          </Link>
        </div>
      </div>
    </main>
  );
}
