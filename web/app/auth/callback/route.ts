import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase/server';
import { safeNext } from '@/lib/redirect';


/**
 * Handles every auth return:
 *  - OAuth (Google) and PKCE magic links:  ?code=...
 *  - Email template links using token_hash: ?token_hash=...&type=magiclink|email
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = safeNext(url.searchParams.get('next'), url.origin);
  const supabase = await supabaseServer();

  const fail = (reason: string) => NextResponse.redirect(new URL(`/?error=${encodeURIComponent(reason)}`, url.origin));

  const providerError = url.searchParams.get('error_description') ?? url.searchParams.get('error');
  if (providerError) return fail(providerError);

  const code = url.searchParams.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return fail(error.message);
    return NextResponse.redirect(new URL(next, url.origin));
  }

  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) return fail(error.message);
    return NextResponse.redirect(new URL(next, url.origin));
  }

  return fail('Sign-in link is missing its code. Request a new one.');
}
