'use client';

// =====================================================
// Tarjeta «Activar avisos» del chat del directivo (L-11).
//
// Sin esto los recordatorios se creaban pero no llegaban: el teléfono nunca
// se había suscrito a las notificaciones (la pantalla de ajustes no existe en
// el modo simple). La tarjeta solo aparece si ESTE teléfono aún no recibe
// avisos, y explica el caso del iPhone (solo desde la app instalada).
// =====================================================

import { useEffect, useState } from 'react';

type Estado =
  | 'oculto'
  | 'activable'
  | 'activando'
  | 'instalar-iphone'
  | 'bloqueado'
  | 'activado'
  | 'error';

const CLAVE_POSPUESTO = 'lexis:avisos:pospuesto';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function esIphone(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function esAppInstalada(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function pospuestoReciente(): boolean {
  try {
    const t = Number(localStorage.getItem(CLAVE_POSPUESTO) || 0);
    return Date.now() - t < 7 * 86_400_000;
  } catch {
    return false;
  }
}

export function ActivarAvisos() {
  const [estado, setEstado] = useState<Estado>('oculto');

  useEffect(() => {
    (async () => {
      const soporta = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
      if (!soporta) {
        if (esIphone() && !esAppInstalada() && !pospuestoReciente()) setEstado('instalar-iphone');
        return;
      }
      if (Notification.permission === 'denied') {
        if (!pospuestoReciente()) setEstado('bloqueado');
        return;
      }
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        if (Notification.permission === 'granted' && sub) return; // ya recibe avisos
      } catch {
        // seguimos: ofrecer activarlos
      }
      if (!pospuestoReciente()) setEstado('activable');
    })();
  }, []);

  async function activar() {
    setEstado('activando');
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== 'granted') {
        setEstado(permiso === 'denied' ? 'bloqueado' : 'activable');
        return;
      }
      const info = await fetch('/api/push/subscribe').then((r) => r.json());
      const clave: string | null = info?.vapid_public_key ?? null;
      if (!clave) throw new Error('sin clave');
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(clave) as BufferSource,
        }));
      const j = sub.toJSON();
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: j.endpoint,
          keys: j.keys,
          user_agent: navigator.userAgent.slice(0, 240),
        }),
      });
      if (!res.ok) throw new Error('subscribe');
      setEstado('activado');
      setTimeout(() => setEstado('oculto'), 4000);
    } catch {
      setEstado('error');
    }
  }

  function posponer() {
    try {
      localStorage.setItem(CLAVE_POSPUESTO, String(Date.now()));
    } catch {
      // sin almacenamiento: se volverá a ofrecer
    }
    setEstado('oculto');
  }

  if (estado === 'oculto') return null;

  const textos: Record<Exclude<Estado, 'oculto'>, string> = {
    activable: 'Para que te lleguen al teléfono los recordatorios que me pidas, activa los avisos.',
    activando: 'Activando… acepta el permiso que te pide el teléfono.',
    'instalar-iphone':
      'Para recibir avisos en el iPhone, abre Lexis desde su icono en la pantalla de inicio. Si aún no lo tienes: botón Compartir (el cuadrado con la flecha) y «Añadir a pantalla de inicio».',
    bloqueado:
      'Los avisos de Lexis están bloqueados en este teléfono. Para activarlos: Ajustes del teléfono → Notificaciones → Lexis (o el navegador) → Permitir.',
    activado: 'Listo: los avisos te llegarán a este teléfono.',
    error: 'No he podido activar los avisos. Inténtalo otra vez en un momento.',
  };

  const conBoton = estado === 'activable' || estado === 'error';

  return (
    <div
      role="status"
      style={{
        margin: '10px auto 0',
        maxWidth: 720,
        width: 'calc(100% - 32px)',
        boxSizing: 'border-box',
        padding: '12px 14px',
        borderRadius: 14,
        border: '1px solid var(--line-strong)',
        background: 'var(--bg-2)',
        color: 'var(--fg-0)',
        fontSize: 16,
        lineHeight: 1.45,
      }}
    >
      <div>🔔 {textos[estado]}</div>
      {(conBoton || estado === 'instalar-iphone' || estado === 'bloqueado') && (
        <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          {conBoton && (
            <button onClick={activar} style={botonPrincipal}>
              Activar avisos
            </button>
          )}
          <button onClick={posponer} style={botonSecundario}>
            {conBoton ? 'Ahora no' : 'Entendido'}
          </button>
        </div>
      )}
    </div>
  );
}

const botonPrincipal: React.CSSProperties = {
  minHeight: 44,
  padding: '10px 18px',
  fontSize: 16,
  fontWeight: 600,
  color: '#fff',
  background: 'var(--grad-accent)',
  border: 'none',
  borderRadius: 12,
  cursor: 'pointer',
};

const botonSecundario: React.CSSProperties = {
  minHeight: 44,
  padding: '10px 18px',
  fontSize: 16,
  color: 'var(--fg-1)',
  background: 'transparent',
  border: '1px solid var(--line-strong)',
  borderRadius: 12,
  cursor: 'pointer',
};
