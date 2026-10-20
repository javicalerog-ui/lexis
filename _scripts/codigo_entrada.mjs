// =====================================================
// Código de entrada a Lexis para un usuario (lo ejecuta Javi en su PC).
//
// Para cuando el correo corporativo no entrega el email con el código:
//   node _scripts/codigo_entrada.mjs usuario@empresa.com
// imprime un código numérico (8 cifras en este proyecto) válido ~1 h. Se le dicta por teléfono y él lo
// escribe en la pantalla de entrada (email + «Ya tengo un código»).
// Generar uno nuevo invalida el anterior.
//
//   --comprobar   no imprime el código (solo verifica que se genera).
//
// Lee NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY de .env.local.
// =====================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(raiz, '.env.local'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
    })
);

const email = process.argv.find((a) => a.includes('@'));
const comprobar = process.argv.includes('--comprobar');
if (!email) {
  console.error('Uso: node _scripts/codigo_entrada.mjs <email> [--comprobar]');
  process.exit(1);
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local');
  process.exit(1);
}

// Proxy corporativo: Node no usa HTTPS_PROXY por sí solo.
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
if (proxy) {
  try {
    const { ProxyAgent, setGlobalDispatcher } = await import('undici');
    setGlobalDispatcher(new ProxyAgent(proxy));
  } catch {
    // sin undici: conexión directa
  }
}

const res = await fetch(`${url}/auth/v1/admin/generate_link`, {
  method: 'POST',
  headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'magiclink', email }),
});
const data = await res.json().catch(() => ({}));
const otp = data?.email_otp ?? data?.properties?.email_otp;
if (!res.ok || !otp) {
  console.error(`No se pudo generar el código (${res.status}): ${data?.msg || data?.error_description || data?.message || 'sin detalle'}`);
  process.exit(1);
}

if (comprobar) {
  console.log(`OK: código de ${String(otp).length} cifras generado para ${email} (no se muestra).`);
} else {
  console.log(`\nCódigo de entrada para ${email}:  ${otp}\n`);
  console.log('En Lexis: escribir el email → «Ya tengo un código» → escribir el código.');
}
