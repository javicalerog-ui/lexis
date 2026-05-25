import Link from 'next/link';
import { Suspense } from 'react';
import { NewConnectorClient } from '@/components/connectors/NewConnectorClient';
import styles from './page.module.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default function NewConnectorPage() {
  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Link href="/connectors" className={styles.back}>
          ← Connectors
        </Link>
        <h1 className={styles.title}>
          <span className={styles.titleAccent}>nuevo connector</span>
        </h1>
        <div />
      </header>

      <div className={styles.content}>
        <Suspense fallback={<p style={{ color: 'var(--fg-3)', fontStyle: 'italic' }}>Cargando…</p>}>
          <NewConnectorClient />
        </Suspense>
      </div>
    </main>
  );
}
