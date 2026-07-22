import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { DigestActions } from '@/components/digest/DigestActions';
import styles from './page.module.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CADENCE_LABEL: Record<string, string> = {
  weekly: 'Semanal',
  biweekly: 'Quincenal',
  monthly: 'Mensual',
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'borrador',
  sent: 'enviado',
  failed: 'fallido',
  skipped: 'omitido',
};

export default async function DigestListPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: digests } = await supabase
    .from('digests')
    .select(
      'id, period_start, period_end, cadence, status, sent_at, payload, metrics, generated_at'
    )
    .eq('user_id', user.id)
    .order('generated_at', { ascending: false })
    .limit(40);

  const { data: prefs } = await supabase
    .from('digest_preferences')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}>
          ← Chat
        </Link>
        <h1 className={styles.title}>
          <span className={styles.titleAccent}>digest</span>
        </h1>
        <div />
      </header>

      <div className={styles.content}>
        <DigestActions initialPrefs={prefs ?? null} userEmail={user.email ?? null} />

        {digests && digests.length > 0 ? (
          <section className={styles.list}>
            <h2 className={styles.listTitle}>
              <span className={styles.listDot} />
              Histórico
              <span className={styles.listCount}>{digests.length}</span>
            </h2>
            <div className={styles.items}>
              {digests.map((d) => {
                const payload = (d.payload as any) ?? {};
                const metrics = (d.metrics as any) ?? {};
                const date = new Date(d.generated_at).toLocaleDateString('es-ES', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                });
                return (
                  <Link
                    key={d.id}
                    href={`/digest/${d.id}`}
                    className={`${styles.item} ${styles[`s_${d.status}`]}`}
                  >
                    <div className={styles.itemHead}>
                      <span className={styles.itemDate}>{date}</span>
                      <span className={styles.itemCadence}>
                        {CADENCE_LABEL[d.cadence] || d.cadence}
                      </span>
                      <span className={`${styles.statusPill} ${styles[`pill_${d.status}`]}`}>
                        {STATUS_LABEL[d.status] || d.status}
                      </span>
                    </div>
                    <p className={styles.itemHeadline}>
                      {payload.headline || '(sin headline)'}
                    </p>
                    <div className={styles.itemMetrics}>
                      <span>{metrics.new_memories ?? 0} memorias</span>
                      <span className={styles.dot} />
                      <span>{metrics.projects_touched ?? 0} proyectos</span>
                      {metrics.decisions_count > 0 && (
                        <>
                          <span className={styles.dot} />
                          <span>{metrics.decisions_count} decisiones</span>
                        </>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        ) : (
          <p className={styles.empty}>
            Aún no se ha generado ningún digest. Pulsa «Generar preview» para ver una vista
            previa o «Enviar ahora» para mandarte el primero por email.
          </p>
        )}
      </div>
    </main>
  );
}
