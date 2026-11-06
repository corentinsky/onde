import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export async function middleware(request: NextRequest) {
  if (!url || !key) return NextResponse.next();
  const p = request.nextUrl.pathname;
  if (p.startsWith('/api/emitter') || p.startsWith('/api/cron/') || p.startsWith('/emetteur/')) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      }
    }
  });

  const {
    data: { user }
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  // Lecteurs et émetteur s’authentifient par leur propre jeton ; /emetteur/ sert les fichiers d’installation (sans secret).
  const isPublic =
    path.startsWith('/login') || path.startsWith('/auth') || path.startsWith('/api/device') || path.startsWith('/api/emitter') || path.startsWith('/lecteur') || path.startsWith('/emetteur/');
  if (!user && !isPublic) {
    const to = request.nextUrl.clone();
    to.pathname = '/login';
    to.searchParams.set('next', path);
    return NextResponse.redirect(to);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp|webmanifest)$).*)']
};
