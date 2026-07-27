import type { Metadata } from 'next';
import Link from 'next/link';
import './acta.css';

export const metadata: Metadata = {
  title: 'Reuniones · Lexis',
  description: 'Graba una reunión, revisa el acta y envíala a tu segundo cerebro.',
};

/**
 * Sección Reuniones (Acta embebida). La grabación y transcripción larga las
 * hace el Worker CF de Acta; la sesión y la BD son las de Lexis desde la
 * consolidación (11-acta-grabador-reuniones/docs/PLAN-CONSOLIDACION-LEXIS.md).
 */
export default function MeetingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="acta">
      <header className="brand">
        <h1>
          <Link href="/meetings" style={{ color: 'inherit', textDecoration: 'none' }}>
            Reuniones
          </Link>
        </h1>
        <span className="tagline">
          <Link href="/" style={{ color: 'inherit' }}>
            ← Lexis
          </Link>
        </span>
        <Link className="gear" href="/meetings/settings" aria-label="Ajustes de reuniones">
          ⚙
        </Link>
      </header>
      {children}
    </div>
  );
}
