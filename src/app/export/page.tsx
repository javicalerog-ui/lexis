import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { ExportClient } from '@/components/export/ExportClient';
import styles from './page.module.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function ExportPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Métricas para mostrar tamaño aproximado
  const { data: snapshot } = await supabase.rpc('user_metrics_snapshot', {
    p_user_id: user.id,
  });

  const interviewCount = await supabase
    .from('interview_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id);

  const digestCount = await supabase
    .from('digests')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id);

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}>
          ← Chat
        </Link>
        <h1 className={styles.title}>
          <span className={styles.titleAccent}>export</span>
        </h1>
        <div />
      </header>

      <div className={styles.content}>
        <section className={styles.intro}>
          <p>
            Descarga todo tu grafo de Lexis como JSON estructurado. Soberanía
            total: tu data, tu copia, portable a cualquier sitio.
          </p>
        </section>

        <ExportClient
          counts={{
            memories: (snapshot as any)?.total_memories ?? 0,
            projects: (snapshot as any)?.total_projects ?? 0,
            entities: (snapshot as any)?.total_entities ?? 0,
            interview_sessions: interviewCount.count ?? 0,
            digests: digestCount.count ?? 0,
          }}
        />
      </div>
    </main>
  );
}
