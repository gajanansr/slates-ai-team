'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { adminClient } from '@/lib/admin-client';
import { SITE_URL } from '@/lib/env';
import { mails, sendMail } from '@/lib/mail';
import { toSlatesError, SlatesError } from '@/lib/slates';

const STATUS: Record<string, number> = { P0401: 401, P0403: 403, P0409: 409, P0422: 422, P0429: 429 };

/** Reserve under my session (permission + quota), send with the service key, record the outcome. */
export async function inviteSomeone(email: string) {
  try {
    const sb = await supabaseServer();
    const { data: me } = await sb.auth.getUser();
    if (!me.user) throw new SlatesError('Sign in first', 401, 'unauthorized');
    const { data: id, error } = await sb.rpc('invite_reserve', { p_email: email });
    if (error) throw new SlatesError(error.message, STATUS[error.code ?? ''] ?? 500, 'invite');

    const admin = adminClient();
    const res = await admin.auth.admin.inviteUserByEmail(email.trim().toLowerCase(), {
      redirectTo: `${SITE_URL}/auth/callback?next=/home`,
      data: { invited_by: me.user.id },
    });
    await admin.rpc('invite_finish', {
      p_id: id,
      p_ok: !res.error,
      p_user_id: res.data?.user?.id ?? null,
      p_error: res.error?.message ?? null,
    });
    if (res.error) throw new SlatesError(`Couldn't send the invite: ${res.error.message}`, 502, 'send_failed');
    revalidatePath('/profile');
    revalidatePath('/admin');
    return { ok: true } as const;
  } catch (e) {
    return { ok: false, error: toSlatesError(e).message } as const;
  }
}

/** Admin: grant/revoke invite access and set the allowance. Turning access on emails them. */
export async function setMemberAccess(userId: string, canInvite: boolean, quota: number, justEnabled = false) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc('admin_set_member', { p_user: userId, p_can_invite: canInvite, p_quota: quota });
  revalidatePath('/admin');
  if (error) return { ok: false, error: error.message } as const;
  if (justEnabled && canInvite) {
    const { data, error: lookup } = await adminClient().auth.admin.getUserById(userId);
    if (!data.user?.email) return { ok: true, mail: `Couldn't email them: ${lookup?.message ?? 'no email on file'}` } as const;
    const sent = await sendMail(data.user.email, mails.canInvite(quota));
    return { ok: true, mail: sent.sent ? `Emailed ${data.user.email}` : `Couldn't email them: ${sent.reason}` } as const;
  }
  return { ok: true } as const;
}

/** Admin: let someone in from the waitlist (sends the invite email) and mark them. */
export async function letInFromWaitlist(email: string) {
  const r = await inviteSomeone(email);
  if (!r.ok) return r;
  const sb = await supabaseServer();
  const { error } = await sb.rpc('admin_waitlist_mark', { p_email: email });
  revalidatePath('/admin');
  return error ? ({ ok: false, error: error.message } as const) : ({ ok: true } as const);
}

/** Admin: create an invite code for public sign-up. */
export async function createInviteCode(label: string, maxUses: number, days: number, code: string) {
  const sb = await supabaseServer();
  const custom = code.trim().toUpperCase();
  if (custom && !/^[A-Z0-9][A-Z0-9-]{3,39}$/.test(custom)) return { ok: false, error: 'Codes use letters, numbers and dashes (4-40)' } as const;
  const { data, error } = await sb.rpc('admin_create_code', {
    p_label: label.slice(0, 60),
    p_max_uses: Math.min(10000, Math.max(1, Math.round(maxUses) || 1)),
    p_days: Math.max(0, Math.round(days) || 0),
    p_code: custom || null,
  });
  revalidatePath('/admin');
  return error
    ? ({ ok: false, error: /duplicate|unique/i.test(error.message) ? 'That code already exists' : error.message } as const)
    : ({ ok: true, code: (data as { code: string }).code } as const);
}

export async function setInviteCodeDisabled(code: string, disabled: boolean) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc('admin_set_code', { p_code: code, p_disabled: disabled });
  revalidatePath('/admin');
  return error ? ({ ok: false, error: error.message } as const) : ({ ok: true } as const);
}
