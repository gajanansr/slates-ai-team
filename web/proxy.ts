import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/env';
import { safeNext } from '@/lib/redirect';

const PROTECTED = /^\/(home|spaces|boards|reminders|s|agents|activity|settings|profile|admin|notes|inbox|ask|call)(\/|$)/;

/** Refresh the Supabase session cookie and gate private routes. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  // getUser() validates the JWT with Supabase Auth (not just the cookie).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

  const redirect = (to: string) => {
    const url = new URL(to, request.nextUrl.origin);
    if (to === '/' && pathname !== '/') url.search = `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
    const r = NextResponse.redirect(url);
    for (const c of response.cookies.getAll()) r.cookies.set(c);
    return r;
  };

  if (!user && PROTECTED.test(pathname)) return redirect('/');
  if (user && pathname === '/') return redirect(safeNext(request.nextUrl.searchParams.get('next'), request.nextUrl.origin));
  return response;
}

export const config = {
  matcher: ['/', '/home/:path*', '/spaces/:path*', '/boards/:path*', '/reminders/:path*', '/s/:path*', '/agents/:path*', '/activity/:path*', '/settings/:path*', '/profile/:path*', '/admin/:path*', '/notes/:path*', '/inbox/:path*', '/ask/:path*', '/call/:path*', '/oauth/authorize'],
};
