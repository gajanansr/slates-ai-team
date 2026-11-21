'use server';
import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { adminClient } from '@/lib/admin-client';
import { supabaseAnon } from '@/lib/supabase/server';
import { SITE_URL } from '@/lib/env';
import { mails, sendMail } from '@/lib/mail';

const REDIRECT = `${SITE_URL}/auth/callback?next=/home`;

/**
 * Invited but never accepted? Send a fresh invite. Outcomes are deliberately coarse so
 * this can't be used to probe which emails have Slates.
 */
export async function requestFreshInvite(email: string): Promise<{ status: 'sent' | 'member' | 'none' }> {
  const clean = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(clean)) return { status: 'none' };
  try {
    const admin = adminClient();
    const { data } = await admin.rpc('invite_resend_check', { p_email: clean });
    if (data === 'member') return { status: 'member' };
    if (data !== 'resend') return { status: 'none' };
    const { error } = await admin.auth.admin.inviteUserByEmail(clean, { redirectTo: REDIRECT });
    return { status: error ? 'none' : 'sent' };
  } catch {
    return { status: 'none' };
  }
}

/** Public sign-up with an invite code. */
export async function joinWithCode(code: string, email: string, honeypot: string) {
  if (honeypot) return { ok: true } as const; // bots fill hidden fields; pretend success
  const clean = email.trim().toLowerCase();
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim();
  // Per-network rate limiting without storing IPs: a salted, daily-rotating hash.
  const day = new Date().toISOString().slice(0, 10);
  const ipHash = ip ? createHash('sha256').update(`${process.env.CRON_SECRET ?? 'slates'}:${day}:${ip}`).digest('hex').slice(0, 32) : null;

  const { data: id, error } = await supabaseAnon().rpc('code_reserve', { p_code: code, p_email: clean, p_ip_hash: ipHash });
  if (error) return { ok: false, error: error.message } as const;
  try {
    const admin = adminClient();
    const res = await admin.auth.admin.inviteUserByEmail(clean, { redirectTo: REDIRECT, data: { invite_code: code.trim().toUpperCase() } });
    await admin.rpc('code_finish', { p_id: id, p_ok: !res.error, p_user_id: res.data?.user?.id ?? null, p_error: res.error?.message ?? null });
    if (res.error) return { ok: false, error: "We couldn't send the email. Try again in a moment." } as const;
    return { ok: true } as const;
  } catch {
    await adminClient().rpc('code_finish', { p_id: id, p_ok: false, p_user_id: null, p_error: 'server error' }).then(
      () => {},
      () => {},
    );
    return { ok: false, error: 'Something went wrong. Try again in a moment.' } as const;
  }
}

/** Public: join the waitlist. Sends a "you're on the list" email when email is set up. */
export async function joinWaitlist(email: string, name: string, note: string, honeypot: string) {
  if (honeypot) return { ok: true, status: 'added', position: 0 } as const;
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim();
  const day = new Date().toISOString().slice(0, 10);
  const ipHash = ip ? createHash('sha256').update(`${process.env.CRON_SECRET ?? 'slates'}:${day}:${ip}`).digest('hex').slice(0, 32) : null;
  const { data, error } = await supabaseAnon().rpc('waitlist_join', { p_email: email, p_name: name || null, p_note: note || null, p_ip_hash: ipHash });
  if (error) return { ok: false, error: error.code === 'P0422' || error.code === 'P0429' ? error.message : "Couldn't add you right now. Try again in a moment." } as const;
  const r = data as { status: 'added' | 'already' | 'member'; position?: number };
  if (r.status === 'added') await sendMail(email.trim().toLowerCase(), mails.waitlisted(r.position ?? 1));
  return { ok: true, status: r.status, position: r.position ?? 0 } as const;
}
