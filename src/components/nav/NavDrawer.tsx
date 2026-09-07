'use client';

// =====================================================
// Menú de navegación lateral (drawer)
//
// Sustituye la fila de iconos crípticos del header por un botón ☰ que abre
// un panel lateral con icono + NOMBRE de cada sección, agrupado y legible.
// Funciona igual en móvil (ocupaba antes toda la anchura) y en escritorio.
// Se cierra al pulsar fuera, la X, Escape o cualquier enlace.
//
// Secciones retiradas a propósito (las rutas siguen existiendo, solo no se
// enlazan): Reuniones/Acta, Entrevista, Conectores, Exportar grafo, Tokens API.
// =====================================================

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Item {
  href: string;
  label: string;
  icon: string;
}

const GROUPS: Array<{ title: string | null; items: Item[] }> = [
  {
    title: null,
    items: [
      { href: '/', label: 'Inicio', icon: '⌂' },
      { href: '/import', label: 'Importar', icon: '⤓' },
    ],
  },
  {
    title: 'Tu conocimiento',
    items: [
      { href: '/timeline', label: 'Cronología', icon: '⌖' },
      { href: '/projects', label: 'Proyectos', icon: '✦' },
      { href: '/entities', label: 'Entidades', icon: '◇' },
      { href: '/feed', label: 'Feed', icon: '◈' },
      { href: '/inbox', label: 'Bandeja', icon: '▤' },
      { href: '/dashboard', label: 'Panel', icon: '⌬' },
    ],
  },
  {
    title: 'Ajustes',
    items: [
      { href: '/digest', label: 'Resumen periódico', icon: '✉' },
      { href: '/settings/password', label: 'Contraseña', icon: '⚿' },
    ],
  },
];

export function NavDrawer({ onLogout }: { onLogout: () => void }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Evita scroll del fondo mientras el menú está abierto
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '11px 14px',
    borderRadius: 'var(--r-md)',
    color: 'var(--fg-1)',
    fontSize: 15,
    textDecoration: 'none',
    transition: 'background var(--dur-fast) var(--ease-out)',
  };
  const iconStyle: React.CSSProperties = {
    width: 22,
    textAlign: 'center',
    fontSize: 15,
    color: 'var(--fg-2)',
    flexShrink: 0,
  };
  const groupTitleStyle: React.CSSProperties = {
    fontSize: 11,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--fg-3)',
    margin: '16px 14px 4px',
  };

  return (
    <>
      <button
        aria-label="Abrir menú"
        onClick={() => setOpen(true)}
        style={{
          width: 34,
          height: 34,
          borderRadius: 'var(--r-full)',
          color: 'var(--fg-1)',
          fontSize: 18,
          background: 'transparent',
          border: '1px solid var(--line)',
          cursor: 'pointer',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        ☰
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(10, 14, 30, 0.45)',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
            zIndex: 'var(--z-modal)' as unknown as number,
            display: 'flex',
            justifyContent: 'flex-start',
          }}
        >
          <nav
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 284,
              maxWidth: '82vw',
              height: '100dvh',
              overflowY: 'auto',
              background: 'var(--bg-2)',
              borderRight: '1px solid var(--line)',
              boxShadow: 'var(--shadow-lg)',
              padding: 10,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 10px 10px',
                borderBottom: '1px solid var(--line)',
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 15,
                  fontWeight: 500,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--fg-0)',
                }}
              >
                Lexis
              </span>
              <button
                aria-label="Cerrar menú"
                onClick={() => setOpen(false)}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 'var(--r-full)',
                  color: 'var(--fg-2)',
                  fontSize: 16,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            {GROUPS.map((g, gi) => (
              <div key={gi}>
                {g.title && <p style={groupTitleStyle}>{g.title}</p>}
                {g.items.map((it) => (
                  <Link
                    key={it.href}
                    href={it.href}
                    onClick={() => setOpen(false)}
                    style={rowStyle}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = 'var(--card-hover)')
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = 'transparent')
                    }
                  >
                    <span style={iconStyle} aria-hidden>
                      {it.icon}
                    </span>
                    {it.label}
                  </Link>
                ))}
              </div>
            ))}

            <div style={{ flex: 1 }} />

            <button
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
              style={{
                ...rowStyle,
                color: 'var(--danger)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                width: '100%',
                textAlign: 'left',
                marginTop: 8,
                borderTop: '1px solid var(--line)',
                borderRadius: 0,
                paddingTop: 14,
              }}
            >
              <span style={{ ...iconStyle, color: 'var(--danger)' }} aria-hidden>
                ⏻
              </span>
              Cerrar sesión
            </button>
          </nav>
        </div>
      )}
    </>
  );
}
