// =====================================================
// fetchJson — wrapper de fetch que NO revienta con "Unexpected token '<'"
//
// Problema que resuelve: el patrón `const data = await res.json()` antes de
// comprobar `res.ok` lanza un SyntaxError ininteligible cuando la API
// devuelve HTML (página de error de Vercel, 401/500 de plataforma, timeout
// del edge) en vez de JSON, ocultando el error real de negocio.
//
// Uso:
//   const data = await fetchJson<{ memories: Memory[] }>('/api/timeline');
//   // lanza Error con el mensaje real si !res.ok o si el body no es JSON.
// =====================================================

export class FetchJsonError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'FetchJsonError';
    this.status = status;
  }
}

export async function fetchJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(input, init);

  // Leemos el cuerpo una sola vez como texto y lo parseamos a mano, para poder
  // dar un mensaje útil tanto si es JSON de error como si es HTML de plataforma.
  const raw = await res.text();
  let body: any = undefined;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = undefined; // no era JSON (probablemente HTML)
    }
  }

  if (!res.ok) {
    const detail =
      (body && (body.detail || body.error || body.message)) ||
      (body === undefined && raw ? `respuesta no-JSON (${res.status})` : '') ||
      `HTTP ${res.status}`;
    throw new FetchJsonError(String(detail), res.status);
  }

  return (body ?? {}) as T;
}
