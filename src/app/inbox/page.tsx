import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { InboxClient } from '@/components/inbox/InboxClient';
import styles from './page.module.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function InboxPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: actions } = await supabase
    .from('agent_actions')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100);

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}>← Inicio</Link>
        <h1 className={styles.title}>
          <span className={styles.titleAccent}>bandeja</span>
        </h1>
        <Link href="/settings/proactive-rules" className={styles.settings}>
          ⚙
        </Link>
      </header>
      <div className={styles.content}>
        <InboxClient initialActions={actions ?? []} />
      </div>
    </main>
  );
}
