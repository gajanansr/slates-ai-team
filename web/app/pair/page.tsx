import { redirect } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { IllustrationPanel } from '@/components/illustrations';
import { Logo } from '@/components/logo';
import { getUser, supabaseServer } from '@/lib/supabase/server';
import { slates } from '@/lib/slates';
import { decidePair, lookup } from './actions';

export const metadata = { title: 'Connect an agent', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | undefined>;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 pb-[calc(24px+var(--safe-bottom))] pt-[calc(32px+var(--safe-top))]">
      {children}
    </main>
  );
}

export default async function Pair({ searchParams }: { searchParams: Promise<Search> }) {
  const q = await searchParams;
  const user = await getUser();
  if (!user) {
    const here = '/pair' + (q.code ? `?code=${encodeURIComponent(q.code)}` : '');
    redirect('/?next=' + encodeURIComponent(here));
  }

  if (q.done) {
    return (
      <Shell>
        <Logo className="mx-auto mb-6 size-12" />
        <h1 className="text-center text-[24px] font-semibold tracking-[-0.03em]">{q.done === 'allowed' ? 'Allowed' : 'Denied'}</h1>
        <p className="mt-3 text-center text-sm text-fg-3">
          {q.done === 'allowed'
            ? 'Go back to your agent. It will finish connecting in a few seconds. You can revoke it any time under Agents.'
            : 'The agent was not given access.'}
        </p>
        <a href="/agents" className="btn btn-glass mt-6 w-full">Open Agents</a>
      </Shell>
    );
  }

  const code = (q.code ?? '').toUpperCase().trim();
  const sb = await supabaseServer();
  const info = code ? ((await sb.rpc('pair_info', { p_user_code: code })).data as { name: string; kind: string; status: string } | null) : null;

  if (!code || !info || info.status !== 'pending') {
    return (
      <Shell>
        <IllustrationPanel name="connect" className="rise mb-7 h-[140px]" />
        <h1 className="text-center text-[26px] font-semibold leading-tight tracking-[-0.03em]">Enter your agent&apos;s code</h1>
        <p className="mt-3 text-center text-sm text-fg-3">
          {code && !info ? 'We could not find that code.' : code && info ? `That code is ${info.status}. Ask the agent for a new one.` : 'Your agent shows a code like K7QM-4TXD.'}
        </p>
        {q.error && <p className="mt-3 text-center text-sm text-fg-2">{q.error}</p>}
        <form action={lookup} className="glass-strong rise-2 mt-8 space-y-3 rounded-[28px] p-5">
          <input name="code" defaultValue={code} placeholder="K7QM-4TXD" autoComplete="off" autoCapitalize="characters" className="field w-full text-center font-mono tracking-[0.2em]" />
          <button className="btn btn-primary w-full">Continue</button>
        </form>
      </Shell>
    );
  }

  const boards = await slates.list({ client: sb, token: null });

  return (
    <Shell>
      <IllustrationPanel name="shield" className="rise mb-7 h-[150px]" />
      <h1 className="rise text-center text-[26px] font-semibold leading-tight tracking-[-0.03em]">{info.name} wants to connect to your Slates</h1>
      <p className="rise mt-3 text-center text-sm text-fg-3">
        Signed in as <span className="text-fg-2">{user.email}</span>. Only allow this if you just asked your agent to connect.
      </p>
      <p className="rise mt-4 text-center font-mono text-[20px] tracking-[0.2em] text-fg">{code}</p>

      <form action={decidePair} className="glass-strong rise-2 mt-6 space-y-4 rounded-[28px] p-5">
        <input type="hidden" name="code" value={code} />
        <fieldset>
          <legend className="kicker mb-2">Access</legend>
          <div className="space-y-2">
            {[
              ['write', 'Read & write', 'Create boards, update items, notify you'],
              ['read', 'Read only', 'See your boards, change nothing'],
            ].map(([value, label, desc]) => (
              <label key={value} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line p-3 has-[:checked]:border-fg has-[:checked]:bg-muted">
                <input type="radio" name="access" value={value} defaultChecked={value === 'write'} className="mt-1 accent-[var(--ink)]" />
                <span>
                  <span className="block text-[15px] font-medium">{label}</span>
                  <span className="block text-xs text-fg-3">{desc}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="kicker mb-2">Expires</legend>
          <select name="days" defaultValue="90" className="field w-full">
            <option value="7">In 7 days</option>
            <option value="30">In 30 days</option>
            <option value="90">In 90 days</option>
            <option value="0">Never</option>
          </select>
        </fieldset>
        {boards.length > 0 && (
          <details className="rounded-2xl border border-line p-3">
            <summary className="cursor-pointer text-[15px] font-medium">Only some boards (optional)</summary>
            <p className="mt-1 text-xs text-fg-3">Tick boards to limit the agent to them. Leave all empty for every board.</p>
            <div className="mt-2 max-h-48 space-y-1.5 overflow-auto">
              {boards.map((b) => (
                <label key={b.slug} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="boards" value={b.slug} className="accent-[var(--ink)]" /> {b.title}
                </label>
              ))}
            </div>
          </details>
        )}
        {q.error && <p className="text-sm text-fg-2">{q.error}</p>}
        <div className="flex gap-2 pt-1">
          <button name="decision" value="deny" className="btn btn-glass flex-1">Deny</button>
          <button name="decision" value="allow" className="btn btn-primary flex-1">Allow</button>
        </div>
        <p className="flex items-start gap-2 text-xs leading-relaxed text-fg-3">
          <ShieldCheck className="mt-0.5 size-3.5 flex-none" strokeWidth={1.75} />
          It appears under Agents, where you can revoke it any time.
        </p>
      </form>
    </Shell>
  );
}
