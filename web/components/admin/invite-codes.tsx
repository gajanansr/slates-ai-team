'use client';
import { useState, useTransition } from 'react';
import { Check, Copy, Loader2, Plus } from 'lucide-react';
import { createInviteCode, setInviteCodeDisabled } from '@/app/(app)/invite-actions';

export type InviteCode = { code: string; label: string | null; max_uses: number; uses: number; joined: number; expires_at: string | null; disabled: boolean; created_at: string };

function CodeRow({ c, origin }: { c: InviteCode; origin: string }) {
  const [copied, setCopied] = useState(false);
  const [off, setOff] = useState(c.disabled);
  const [pending, start] = useTransition();
  const expired = c.expires_at !== null && new Date(c.expires_at) < new Date();
  const full = c.uses >= c.max_uses;
  const link = `${origin}/join?code=${c.code}`;
  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-[14px] tracking-[0.06em]">{c.code}</span>
          <span className="block truncate text-[12px] text-fg-3">
            {c.label ? `${c.label} · ` : ''}
            {c.uses}/{c.max_uses} used · {c.joined} joined
            {c.expires_at ? ` · ${expired ? 'expired' : `until ${new Date(c.expires_at).toLocaleDateString('en', { day: 'numeric', month: 'short' })}`}` : ''}
          </span>
        </span>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="grid size-9 place-items-center rounded-full bg-muted text-fg-2 active:scale-95"
          aria-label={`Copy join link for ${c.code}`}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" strokeWidth={1.75} />}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await setInviteCodeDisabled(c.code, !off);
              if (r.ok) setOff(!off);
            })
          }
          className={`h-9 rounded-full px-3 text-[12.5px] font-medium ${off ? 'bg-muted text-fg-3' : 'bg-btn text-on-btn'}`}
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : off ? 'Disabled' : expired || full ? 'Closed' : 'Active'}
        </button>
      </div>
    </li>
  );
}

export function InviteCodes({ codes }: { codes: InviteCode[] }) {
  const [label, setLabel] = useState('');
  const [uses, setUses] = useState(25);
  const [days, setDays] = useState(30);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  const origin = typeof window === 'undefined' ? 'https://www.slates.space' : window.location.origin;
  return (
    <section className="card p-4">
      <h3 className="mb-1 text-[15px] font-medium tracking-tight">Invite codes</h3>
      <p className="mb-3 text-[12.5px] text-fg-3">Slates is invite-only. A code lets people join without you inviting each email.</p>
      <details className="mb-4 rounded-2xl bg-muted px-3.5 py-3 text-[13px] text-fg-2">
        <summary className="cursor-pointer font-medium text-fg">How invite codes work</summary>
        <ol className="mt-2 list-decimal space-y-1.5 pl-4 leading-relaxed">
          <li>
            <b className="font-medium text-fg">Create a code.</b> <i className="not-italic text-fg">Uses</i> is how many people can join with it.{' '}
            <i className="not-italic text-fg">Days</i> is how long it works (0 = no end). Leave <i className="not-italic text-fg">Code</i> empty for a random one, or type
            a word like LAUNCH.
          </li>
          <li>
            <b className="font-medium text-fg">Share it.</b> Tap the copy button for a link (slates.space/join?code=…), or post the code itself. People open /join, enter
            the code and their email, and get a sign-in code by email.
          </li>
          <li>
            <b className="font-medium text-fg">Watch and stop.</b> Each row shows used / allowed and how many actually joined. Tap Active to turn a code off at once.
          </li>
          <li>
            <b className="font-medium text-fg">Let members invite.</b> Under People, switch on “Can invite” for someone and set how many invites they get. They then invite by
            email from their You page.
          </li>
        </ol>
      </details>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setMsg('');
            const r = await createInviteCode(label, uses, days, code);
            if (r.ok) {
              setMsg(`Created ${r.code}`);
              setLabel('');
              setCode('');
            } else setMsg(r.error);
          });
        }}
      >
        <input className="field" placeholder="Label, e.g. Twitter launch" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} aria-label="Label" />
        <div className="grid grid-cols-3 gap-2 [&>*]:min-w-0">
          <label className="block">
            <span className="mb-1 block text-[11.5px] text-fg-3">Uses</span>
            <input type="number" min={1} max={10000} className="field" value={uses} onChange={(e) => setUses(Number(e.target.value))} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11.5px] text-fg-3">Days (0 = no end)</span>
            <input type="number" min={0} max={3650} className="field" value={days} onChange={(e) => setDays(Number(e.target.value))} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11.5px] text-fg-3">Code (optional)</span>
            <input className="field font-mono uppercase" placeholder="auto" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={40} />
          </label>
        </div>
        <button className="btn btn-primary w-full" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Create code
        </button>
        {msg && <p className="text-sm text-fg-2">{msg}</p>}
      </form>
      {codes.length > 0 && (
        <ul className="mt-3 divide-y divide-line">
          {codes.map((c) => (
            <CodeRow key={c.code} c={c} origin={origin} />
          ))}
        </ul>
      )}
    </section>
  );
}
