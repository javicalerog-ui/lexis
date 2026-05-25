import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { ActivityChart } from '@/components/dashboard/ActivityChart';
import { SourceDistribution } from '@/components/dashboard/SourceDistribution';
import styles from './page.module.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SOURCE_LABEL: Record<string, string> = {
  text: 'Texto',
  voice: 'Voz',
  image: 'Imagen',
  pdf: 'PDF',
  xlsx: 'Hoja',
  md: 'Markdown',
  url: 'URL',
};

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Snapshot principal
  const { data: snapshotRaw } = await supabase.rpc('user_metrics_snapshot', {
    p_user_id: user.id,
  });
  const snapshot = (snapshotRaw as any) ?? {};

  // Actividad últimos 90 días, granularidad semanal
  const from90 = new Date(Date.now() - 90 * 86400_000).toISOString();
  const { data: buckets } = await supabase.rpc('user_activity_buckets', {
    p_user_id: user.id,
    p_granularity: 'week',
    p_from: from90,
  });

  // Top proyectos por actividad reciente (60d)
  const recent60 = new Date(Date.now() - 60 * 86400_000).toISOString();
  const { data: recentMems } = await supabase
    .from('memories')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .gte('captured_at', recent60);

  const memIds = (recentMems ?? []).map((m) => m.id);

  let topProjects: Array<{ id: string; name: string; slug: string; count: number; status: string }> = [];
  if (memIds.length) {
    const { data: pLinks } = await supabase
      .from('memory_projects')
      .select('project_id, projects(id, name, slug, status)')
      .in('memory_id', memIds);
    const map = new Map<string, { id: string; name: string; slug: string; count: number; status: string }>();
    for (const l of pLinks ?? []) {
      const p: any = (l as any).projects;
      if (!p) continue;
      const prev = map.get(p.id);
      if (prev) prev.count++;
      else map.set(p.id, { id: p.id, name: p.name, slug: p.slug, status: p.status, count: 1 });
    }
    topProjects = Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 8);
  }

  // Top entidades por interacciones globales
  const { data: topEntities } = await supabase
    .from('entities')
    .select('id, name, entity_type, interaction_count')
    .eq('user_id', user.id)
    .gt('interaction_count', 0)
    .order('interaction_count', { ascending: false })
    .limit(8);

  // Métricas derivadas
  const memoriesPerWeekAvg =
    buckets && buckets.length > 0
      ? Math.round(buckets.reduce((sum: number, b: any) => sum + b.count, 0) / buckets.length)
      : 0;

  const last7d = snapshot.memories_last_7d ?? 0;
  const last30d = snapshot.memories_last_30d ?? 0;
  const weeklyVelocity = last7d;
  const monthlyVelocity = last30d;

  const lastCaptureDate = snapshot.last_capture
    ? new Date(snapshot.last_capture).toLocaleString('es-ES', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

  const maxTopProjectCount = topProjects[0]?.count ?? 1;
  const maxTopEntityCount = topEntities?.[0]?.interaction_count ?? 1;

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}>
          ← Chat
        </Link>
        <h1 className={styles.title}>
          <span className={styles.titleAccent}>dashboard</span>
        </h1>
        <div />
      </header>

      <div className={styles.content}>
        {/* Métricas principales */}
        <section className={styles.heroGrid}>
          <MetricCard
            label="Memorias totales"
            value={snapshot.total_memories ?? 0}
            accent
          />
          <MetricCard
            label="Proyectos activos"
            value={snapshot.active_projects ?? 0}
            sub={`${snapshot.total_projects ?? 0} totales`}
          />
          <MetricCard
            label="Entidades"
            value={snapshot.total_entities ?? 0}
          />
          <MetricCard
            label="Última captura"
            value={lastCaptureDate}
            small
          />
        </section>

        {/* Velocidad */}
        <section className={styles.velocityRow}>
          <div className={styles.velocityCard}>
            <span className={styles.velocityLabel}>Esta semana</span>
            <span className={styles.velocityValue}>{weeklyVelocity}</span>
            <span className={styles.velocityUnit}>memorias</span>
          </div>
          <div className={styles.velocityCard}>
            <span className={styles.velocityLabel}>Este mes</span>
            <span className={styles.velocityValue}>{monthlyVelocity}</span>
            <span className={styles.velocityUnit}>memorias</span>
          </div>
          <div className={styles.velocityCard}>
            <span className={styles.velocityLabel}>Promedio semanal</span>
            <span className={styles.velocityValue}>{memoriesPerWeekAvg}</span>
            <span className={styles.velocityUnit}>últimas 13 semanas</span>
          </div>
        </section>

        {/* Gráfico actividad */}
        <section className={styles.chartCard}>
          <header className={styles.chartHead}>
            <span className={styles.chartDot} />
            <h2 className={styles.chartTitle}>Actividad · últimas 13 semanas</h2>
          </header>
          <ActivityChart buckets={buckets ?? []} />
        </section>

        {/* Grid: distribución + top proyectos */}
        <div className={styles.twoCol}>
          <section className={styles.subCard}>
            <header className={styles.subHead}>
              <span className={styles.subDotViolet} />
              <h3 className={styles.subTitle}>Por tipo de fuente</h3>
            </header>
            <SourceDistribution data={snapshot.by_source_type || {}} />
          </section>

          <section className={styles.subCard}>
            <header className={styles.subHead}>
              <span className={styles.subDot} />
              <h3 className={styles.subTitle}>Proyectos más activos · 60d</h3>
            </header>
            {topProjects.length > 0 ? (
              <ol className={styles.barList}>
                {topProjects.map((p) => (
                  <li key={p.id} className={styles.barRow}>
                    <Link href={`/projects/${p.slug}`} className={styles.barLink}>
                      <span className={styles.barLabel}>{p.name}</span>
                      <span className={styles.barTrack}>
                        <span
                          className={styles.barFill}
                          style={{
                            width: `${Math.round((p.count / maxTopProjectCount) * 100)}%`,
                          }}
                        />
                      </span>
                      <span className={styles.barCount}>{p.count}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            ) : (
              <p className={styles.empty}>Sin actividad reciente.</p>
            )}
          </section>
        </div>

        {/* Top entidades */}
        <section className={styles.subCardFull}>
          <header className={styles.subHead}>
            <span className={styles.subDotViolet} />
            <h3 className={styles.subTitle}>Entidades más mencionadas</h3>
          </header>
          {topEntities && topEntities.length > 0 ? (
            <ol className={styles.barList}>
              {topEntities.map((e) => (
                <li key={e.id} className={styles.barRow}>
                  <Link href={`/entities/${e.id}`} className={styles.barLink}>
                    <span className={styles.barLabel}>
                      <span className={`${styles.entDot} ${styles[`type_${e.entity_type}`]}`} />
                      {e.name}
                    </span>
                    <span className={styles.barTrack}>
                      <span
                        className={`${styles.barFill} ${styles.barFillViolet}`}
                        style={{
                          width: `${Math.round((e.interaction_count / maxTopEntityCount) * 100)}%`,
                        }}
                      />
                    </span>
                    <span className={styles.barCount}>{e.interaction_count}</span>
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.empty}>Sin entidades todavía.</p>
          )}
        </section>
      </div>
    </main>
  );
}

function MetricCard({
  label,
  value,
  sub,
  accent,
  small,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
  small?: boolean;
}) {
  return (
    <div className={`${styles.metric} ${accent ? styles.metricAccent : ''}`}>
      <span className={`${styles.metricN} ${small ? styles.metricNSmall : ''}`}>
        {value}
      </span>
      <span className={styles.metricL}>{label}</span>
      {sub && <span className={styles.metricSub}>{sub}</span>}
    </div>
  );
}
