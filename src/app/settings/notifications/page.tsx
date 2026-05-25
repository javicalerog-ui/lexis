import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { loadUserSettings } from '@/lib/time/userTime';
import { NotificationsSettingsClient } from '@/components/settings/NotificationsSettingsClient';
import styles from './page.module.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function NotificationsSettingsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const settings = await loadUserSettings(supabase, user.id, { createIfMissing: true });
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY ?? null;

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Link href="/settings" className={styles.back}>← Settings</Link>
        <h1 className={styles.title}>
          <span className={styles.titleAccent}>notificaciones</span>
        </h1>
        <div />
      </header>
      <div className={styles.content}>
        <NotificationsSettingsClient
          initialSettings={settings}
          vapidPublicKey={vapidPublicKey}
        />
      </div>
    </main>
  );
}
