import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ensurePresetsForUser } from '@/lib/proactive/manage';
import { ProactiveRulesClient } from '@/components/settings/ProactiveRulesClient';
import styles from './page.module.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function ProactiveRulesPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  await ensurePresetsForUser(supabase, user.id);

  const { data: rules } = await supabase
    .from('proactive_rules')
    .select('*')
    .eq('user_id', user.id)
    .order('kind', { ascending: true })
    .order('created_at', { ascending: true });

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Link href="/settings" className={styles.back}>← Settings</Link>
        <h1 className={styles.title}>
          <span className={styles.titleAccent}>reglas proactivas</span>
        </h1>
        <div />
      </header>
      <div className={styles.content}>
        <ProactiveRulesClient initialRules={rules ?? []} />
      </div>
    </main>
  );
}
