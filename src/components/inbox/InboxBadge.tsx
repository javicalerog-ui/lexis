'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from './InboxBadge.module.css';

/**
 * Icono ⊞ que enlaza a /inbox con badge dinámico de actions pending.
 * Refresca cada 60s (light polling) y al volver el focus.
 */
export function InboxBadge() {
  const [count, setCount] = useState<number | null>(null);

  async function refresh() {
    try {
      const res = await fetch('/api/agent-actions?status=pending&limit=1', {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = await res.json();
      setCount(data.pending_count ?? 0);
    } catch {}
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60_000);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  return (
    <Link href="/inbox" className={styles.link} title="Bandeja">
      <span className={styles.glyph}>⊞</span>
      {count !== null && count > 0 && (
        <span className={styles.badge}>{count > 99 ? '99+' : count}</span>
      )}
    </Link>
  );
}
