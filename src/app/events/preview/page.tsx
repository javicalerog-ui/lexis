import { Suspense } from 'react';
import Link from 'next/link';
import { EventsPreviewClient } from '@/components/events/EventsPreviewClient';
import styles from './page.module.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default function EventsPreviewPage() {
  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}>← Volver</Link>
        <h1 className={styles.title}>
          <span className={styles.titleAccent}>preview de eventos</span>
        </h1>
        <div />
      </header>
      <div className={styles.content}>
        <Suspense fallback={<p style={{ color: 'var(--fg-3)' }}>Cargando…</p>}>
          <EventsPreviewClient />
        </Suspense>
      </div>
    </main>
  );
}
