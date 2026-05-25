import Link from 'next/link';
import { ConnectorDetailClient } from '@/components/connectors/ConnectorDetailClient';
import styles from './page.module.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: { id: string };
}

export default function ConnectorDetailPage({ params }: RouteParams) {
  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Link href="/connectors" className={styles.back}>
          ← Connectors
        </Link>
        <h1 className={styles.title}>
          <span className={styles.titleAccent}>detalle</span>
        </h1>
        <div />
      </header>

      <div className={styles.content}>
        <ConnectorDetailClient id={params.id} />
      </div>
    </main>
  );
}
