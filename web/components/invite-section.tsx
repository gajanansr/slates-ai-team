'use client';
import { useState, useTransition } from 'react';
import { Loader2, Send, UserPlus } from 'lucide-react';
import { inviteSomeone } from '@/app/(app)/invite-actions';

export type Membership = {
  role: 'admin' | 'member';
  can_invite: boolean;
  quota: number | null;
  used: number;
  invites: { id: string; email: string; status: string; accepted: boolean; created_at: string }[];
};

export function InviteSection({ m }: { m: Membership }) {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const left = m.quota === null ? null : Math.max(0, m.quota - m.used);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="kicker">Invite people</h2>
        {m.can_invite && <span className="pill">{left === null ? 'Unlimited' : `${left} of ${m.quota} left`}</span>}
      </div>

      {!m.can_invite ? (
        <p className="note">
          <UserPlus className="mt-0.5 size-4 flex-none" strokeWidth={1.75} />
          Slates is invite-only. When the admin gives you invites, you can bring up to 5 people here.
        </p>
      ) : (
        <div className="card space-y-3 p-4">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                setMsg(null);
                const r = await inviteSomeone(email);
                if (r.ok) {
                  setMsg({ ok: true, text: `Invite sent to ${email.trim()}` });
                  setEmail('');
                } else setMsg({ ok: false, text: r.error });
              });
            }}
          >
            <input
              type="email"
              inputMode="email"
              autoComplete="off"
              className="field min-w-0 flex-1"
              placeholder="friend@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Email to invite"
              disabled={left === 0}
            />
            <button className="btn btn-primary h-[50px] px-4" disabled={pending || !email.trim() || left === 0}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" strokeWidth={1.75} />}
              Invite
            </button>
          </form>
          {msg && <p className={`text-sm ${msg.ok ? 'text-fg-2' : 'text-fg'}`}>{msg.text}</p>}
          {m.invites.length > 0 && (
            <ul className="divide-y divide-line">
              {m.invites.map((i) => (
                <li key={i.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-[14px]">{i.email}</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ${i.accepted ? 'bg-accent text-on-accent' : 'bg-muted text-fg-2'}`}>
                    {i.accepted ? 'Joined' : i.status === 'pending' ? 'Sending' : 'Invite sent'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs leading-relaxed text-fg-3">
            They get an email from Slates and their own private space. They see nothing of yours.
          </p>
        </div>
      )}
    </section>
  );
}
