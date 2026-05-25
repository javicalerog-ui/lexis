import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import styles from './page.module.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TYPE_LABEL: Record<string, string> = {
  person: 'Personas',
  org: 'Organizaciones',
  place: 'Lugares',
  concept: 'Conceptos',
  product: 'Productos',
};

const TYPE_ORDER = ['person', 'org', 'product', 'place', 'concept'];

export default async function EntitiesPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: entities } = await supabase
    .from('entities')
    .select(
      'id, name, entity_type, aliases, last_seen_at, attributes, interaction_count, summary_stale'
    )
    .eq('user_id', user.id)
    .order('interaction_count', { ascending: false })
    .order('last_seen_at', { ascending: false, nullsFirst: false });

  // El interaction_count ya está en cada entidad (Sprint 6).
  // Lo exponemos como counts para no tener que tocar el resto del JSX.
  const counts: Record<string, number> = {};
  for (const e of entities ?? []) {
    counts[e.id] = e.interaction_count ?? 0;
  }

  // Agrupar por tipo
  const grouped: Record<string, typeof entities> = {};
  for (const e of entities ?? []) {
    if (!grouped[e.entity_type]) grouped[e.entity_type] = [];
    grouped[e.entity_type]!.push(e);
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}>
          ← Chat
        </Link>
        <h1 className={styles.title}>
          <span className={styles.titleAccent}>entidades</span>
        </h1>
        <div />
      </header>

      <div className={styles.content}>
        {!entities?.length && (
          <div className={styles.empty}>
            <p>
              Aún no hay entidades. Lexis las irá creando cuando captures memorias que
              mencionen personas, organizaciones, lugares, conceptos o productos.
            </p>
          </div>
        )}

        {TYPE_ORDER.map((type) => {
          const list = grouped[type];
          if (!list?.length) return null;
          return (
            <section key={type} className={styles.section}>
              <header className={styles.sectionHead}>
                <span className={`${styles.typeDot} ${styles[`dot_${type}`]}`} />
                <h2 className={styles.sectionTitle}>{TYPE_LABEL[type]}</h2>
                <span className={styles.sectionCount}>{list.length}</span>
              </header>
              <div className={styles.grid}>
                {list.map((e) => (
                  <Link key={e.id} href={`/entities/${e.id}`} className={styles.card}>
                    <span className={styles.name}>{e.name}</span>
                    {(counts[e.id] ?? 0) > 0 && (
                      <span className={styles.count}>{counts[e.id]}</span>
                    )}
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
