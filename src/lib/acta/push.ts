// Alta de Web Push (S5). En iOS requiere PWA instalada (>= 16.4).

import { api } from './api';

// Retorno Uint8Array<ArrayBuffer>: con TS >=5.7, `Uint8Array` a secas es
// Uint8Array<ArrayBufferLike> y ya no es asignable a BufferSource
// (applicationServerKey). new Uint8Array(n) siempre crea ArrayBuffer real.
function urlB64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushResult = 'ok' | 'denied' | 'unavailable';

export async function subscribePush(): Promise<PushResult> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unavailable';
  }
  const { key, enabled } = await api<{ key: string | null; enabled: boolean }>('/api/push/public-key');
  if (!enabled || !key) return 'unavailable';

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlB64ToUint8Array(key),
  });
  const j = sub.toJSON();
  await api('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({
      endpoint: sub.endpoint,
      keys: { p256dh: j.keys!.p256dh, auth: j.keys!.auth },
      user_agent: navigator.userAgent,
    }),
  });
  return 'ok';
}
