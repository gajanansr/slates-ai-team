import 'server-only';
import { SITE_URL } from '@/lib/env';

/**
 * Transactional email (waitlist confirmation, "you can invite now") through Resend's HTTP API.
 * Sign-in codes and invites still come from Supabase Auth. Without RESEND_API_KEY these
 * emails are skipped, never errors: the action they belong to still succeeds.
 */
export const mailReady = () => Boolean(process.env.RESEND_API_KEY);
export const mailFrom = () => process.env.MAIL_FROM || 'Slates <hello@slates.space>';

export async function sendMail(to: string, mail: { subject: string; html: string; text: string }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false as const, reason: 'not configured' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: mailFrom(), to: [to], ...mail }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      console.warn('[mail]', res.status, body);
      return { sent: false as const, reason: `Resend ${res.status}: ${body}` };
    }
    return { sent: true as const, id: ((await res.json().catch(() => ({}))) as { id?: string }).id };
  } catch (e) {
    console.warn('[mail]', (e as Error).message);
    return { sent: false as const, reason: 'unreachable' };
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** One calm layout for every Slates email: mark, headline, a line or two, one button. */
export function layout({ title, body, cta, href }: { title: string; body: string; cta?: string; href?: string }) {
  const button = cta && href
    ? `<tr><td style="padding:28px 0 4px"><a href="${href}" style="display:inline-block;background:#1f2a26;color:#e1f48a;text-decoration:none;font-weight:600;font-size:15px;padding:14px 26px;border-radius:999px">${esc(cta)}</a></td></tr>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f1f2ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2a26">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f2ec;padding:40px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fbfbf8;border-radius:24px;padding:36px 32px">
<tr><td><img src="${SITE_URL}/icon-192.png" width="44" height="44" alt="Slates" style="border-radius:12px;display:block"></td></tr>
<tr><td style="padding-top:24px;font-size:24px;line-height:1.25;font-weight:600;letter-spacing:-0.02em">${esc(title)}</td></tr>
<tr><td style="padding-top:12px;font-size:15px;line-height:1.6;color:#4d5651">${body}</td></tr>
${button}
</table>
<p style="font-size:12px;color:#7b837e;margin:20px 0 0">Slates · <a href="${SITE_URL}" style="color:#7b837e">slates.space</a></p>
</td></tr></table></body></html>`;
}

export const mails = {
  waitlisted: (position: number) => ({
    subject: "You're on the Slates waitlist",
    html: layout({
      title: "You're on the list.",
      body: `Thanks for your interest in Slates. You're <b>#${position}</b> in line. We'll email you as soon as your spot opens up.`,
    }),
    text: `You're on the Slates waitlist (#${position} in line). We'll email you when your spot opens up.\n\n${SITE_URL}`,
  }),
  canInvite: (quota: number | null) => {
    const n = quota === null ? 'as many people as you like' : `up to ${quota} ${quota === 1 ? 'person' : 'people'}`;
    return {
      subject: 'You can now invite people to Slates',
      html: layout({
        title: 'You can invite friends now.',
        body: `You can now bring ${n} to Slates. Open <b>You → Invite people</b> and enter their email.`,
        cta: 'Invite someone',
        href: `${SITE_URL}/settings`,
      }),
      text: `You can now invite ${n} to Slates. Open You > Invite people: ${SITE_URL}/settings`,
    };
  },
};
