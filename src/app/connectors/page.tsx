import Link from 'next/link';
import { ConnectorsListClient } from '@/components/connectors/ConnectorsListClient';
import styles from './page.module.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default function ConnectorsPage() {
  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}>
          ← Chat
        </Link>
        <h1 className={styles.title}>
          <span className={styles.titleAccent}>connectors</span>
        </h1>
        <div />
      </header>

      <div className={styles.content}>
        <section className={styles.intro}>
          <p>
            Integraciones que alimentan o leen Lexis automáticamente.
            Pull (programado) y push (webhooks entrantes) en una sola caja.
          </p>
          <p className={styles.introSub}>
            Disponibles: <strong>Gmail</strong>, <strong>Drive</strong>,{' '}
            <strong>RSS</strong> y <strong>webhooks entrantes</strong>.
          </p>
        </section>

        <ConnectorsListClient />
      </div>
    </main>
  );
}
