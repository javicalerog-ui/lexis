import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { TimelineClient } from '@/components/search/TimelineClient';
import styles from './page.module.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function TimelinePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Cargar proyectos y entidades para los filtros
  const [projectsRes, entitiesRes] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, slug')
      .eq('user_id', user.id)
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .limit(60),
    supabase
      .from('entities')
      .select('id, name, entity_type')
      .eq('user_id', user.id)
      .gt('interaction_count', 0)
      .order('interaction_count', { ascending: false })
      .limit(80),
  ]);

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}>
          ← Chat
        </Link>
        <h1 className={styles.title}>
          <span className={styles.titleAccent}>timeline</span>
        </h1>
        <div />
      </header>

      <div className={styles.content}>
        <TimelineClient
          projects={projectsRes.data ?? []}
          entities={entitiesRes.data ?? []}
        />
      </div>
    </main>
  );
}
