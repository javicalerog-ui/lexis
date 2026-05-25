import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Aplicar en todas las rutas menos assets estáticos.
    '/((?!_next/static|_next/image|favicon.ico|icons|fonts|.*\\.(?:png|jpg|jpeg|svg|webp)$).*)',
  ],
};
