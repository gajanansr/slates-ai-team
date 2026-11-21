import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  const res = NextResponse.redirect(new URL('/', request.nextUrl.origin), { status: 303 });
  // Drop any offline copies of private pages on this device.
  res.headers.set('Clear-Site-Data', '"cache"');
  return res;
}
