import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase/server';

const TYPES: EmailOtpType[] = ['invite', 'magiclink', 'email', 'signup'];

/**
 * POST-only verification (the Accept button). Mail scanners that pre-open links only
 * GET the page, so they can no longer use up one-time invite tokens.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const tokenHash = String(form.get('token_hash') ?? '');
  const type = String(form.get('type') ?? 'invite') as EmailOtpType;
  const back = (q: string) => NextResponse.redirect(new URL(`/auth/accept?${q}`, request.nextUrl.origin), { status: 303 });
  if (!tokenHash || !TYPES.includes(type)) return back('error=invalid');
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) return back(`error=expired&type=${type}`);
  return NextResponse.redirect(new URL('/home', request.nextUrl.origin), { status: 303 });
}
