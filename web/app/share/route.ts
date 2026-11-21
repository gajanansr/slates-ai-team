import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { inbox } from '@/lib/inbox';
import { uploadFiles } from '@/lib/files';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Web Share Target (manifest share_target): Android's share sheet POSTs here with the
 * title/text/url and any images. Everything lands in the Inbox.
 */
export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const client = await supabaseServer();
  const { data } = await client.auth.getUser();
  if (!data.user) return NextResponse.redirect(`${origin}/?next=/inbox`, 303);
  try {
    const form = await req.formData();
    const s = (k: string) => (typeof form.get(k) === 'string' ? String(form.get(k)).trim() : '');
    const title = s('title');
    const text = s('text');
    const url = s('url') || text.match(/https?:\/\/\S+/)?.[0] || '';
    const blobs = form.getAll('file').filter((f): f is File => typeof f === 'object' && f !== null && 'arrayBuffer' in f && (f as File).size > 0);
    const files = blobs.length ? await uploadFiles(client, data.user.id, blobs) : [];
    const main = title || text.replace(url, '').trim() || url;
    const detail = title && text && text !== url ? text.replace(url, '').trim() || undefined : undefined;
    await inbox.capture({ client, token: null }, { text: main, url: url || undefined, detail, files, source: 'Shared' });
    return NextResponse.redirect(`${origin}/inbox?captured=1`, 303);
  } catch (e) {
    console.error('[share]', e);
    return NextResponse.redirect(`${origin}/inbox?captured=0`, 303);
  }
}

export function GET(req: Request) {
  return NextResponse.redirect(new URL('/inbox', req.url), 303);
}
