import Link from 'next/link';
import { TokensClient } from '@/components/tokens/TokensClient';
import styles from './page.module.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function TokensSettingsPage() {
  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}>
          ← Chat
        </Link>
        <h1 className={styles.title}>
          <span className={styles.titleAccent}>tokens</span>
        </h1>
        <div />
      </header>

      <div className={styles.content}>
        <section className={styles.intro}>
          <p>
            Los <strong>Personal Access Tokens</strong> dan acceso a la API
            pública de Lexis sobre tus propios datos. Úsalos para integrar n8n,
            scripts, o cualquier herramienta externa que necesite leer o capturar
            memorias.
          </p>
          <p className={styles.introSub}>
            Endpoint base: <code>/api/v1</code>. Auth via{' '}
            <code>Authorization: Bearer pat_...</code>.
          </p>
        </section>

        <TokensClient />
      </div>
    </main>
  );
}
