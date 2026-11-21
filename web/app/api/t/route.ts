import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|embedly|vercel-screenshot/i;

function device(ua: string) {
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) return 'tablet';
  if (/mobi|iphone|android/i.test(ua)) return 'mobile';
  if (/macintosh|windows|linux|cros/i.test(ua)) return 'desktop';
  return 'other';
}

/**
 * First-party page-view beacon. Stores a random visitor id (cookie), the page path
 * (private segments collapsed in the DB), referrer host, country (Vercel header),
 * device class and installed-app flag. No IP addresses, no fingerprinting.
 */
export async function POST(req: Request) {
  const ua = req.headers.get('user-agent') ?? '';
  if (!ua || BOT.test(ua)) return new Response(null, { status: 204 });
  let body: { path?: string; ref?: string; standalone?: boolean } = {};
  try {
    body = JSON.parse(await req.text());
  } catch {
    return new Response(null, { status: 204 });
  }
  const store = await cookies();
  let vid = store.get('sl_vid')?.value;
  if (!vid || !/^[A-Za-z0-9-]{8,64}$/.test(vid)) {
    vid = crypto.randomUUID();
    store.set('sl_vid', vid, { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 60 * 60 * 24 * 365 });
  }
  let ref: string | null = null;
  try {
    const host = body.ref ? new URL(body.ref).hostname.replace(/^www\./, '') : '';
    ref = host && !host.endsWith('slates.space') ? host : null;
  } catch {
    ref = null;
  }
  // Session client: the DB attributes the view to auth.uid() from the verified JWT.
  const sb = await supabaseServer();
  await sb.rpc('track_view', {
    p_visitor: vid,
    p_path: typeof body.path === 'string' ? body.path.slice(0, 200) : '/',
    p_referrer: ref,
    p_country: req.headers.get('x-vercel-ip-country'),
    p_device: device(ua),
    p_standalone: body.standalone === true,
  });
  return new Response(null, { status: 204 });
}
