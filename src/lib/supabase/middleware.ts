import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: '', ...options });
        },
      },
    }
  );

  const { data: { session } } = await supabase.auth.getSession();

  const pathname = request.nextUrl.pathname;
  const isAuthRoute = pathname.startsWith('/auth');
  const isApiAuth = pathname.startsWith('/api/auth');
  // Endpoints que se llaman SIN cookie de sesión y se autentican por su cuenta
  // (CRON_SECRET, Personal Access Token, o el secret del webhook). Sin esta
  // exención el middleware los redirige 302 a /auth/login y quedan inaccesibles
  // para el cron externo, la API pública v1 y los webhooks entrantes.
  const isCron = pathname.startsWith('/api/cron');
  const isPublicApiV1 = pathname.startsWith('/api/v1');
  const isWebhookInbound =
    pathname.startsWith('/api/connectors/') && pathname.endsWith('/inbound');
  const isPublic =
    isAuthRoute ||
    isApiAuth ||
    isCron ||
    isPublicApiV1 ||
    isWebhookInbound ||
    pathname === '/manifest.json';

  if (!session && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Modo Silvestre: usuarios con app_metadata.ui_mode='simple' viven en una
  // sola pantalla (/asistente). Cualquier PÁGINA del app completo los reenvía
  // ahí. No se tocan las /api (las gobierna su propio auth) ni los estáticos.
  if (session && session.user?.app_metadata?.ui_mode === 'simple') {
    const esApi = pathname.startsWith('/api');
    const esEstatico =
      pathname.startsWith('/_next') ||
      pathname.startsWith('/icons') ||
      pathname === '/favicon.ico' ||
      pathname === '/manifest.json' ||
      pathname === '/sw.js';
    const permitido = pathname === '/asistente' || isAuthRoute || esApi || esEstatico;
    if (!permitido) {
      const url = request.nextUrl.clone();
      url.pathname = '/asistente';
      url.search = '';
      return NextResponse.redirect(url);
    }
  }

  return response;
}
