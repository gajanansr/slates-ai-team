import { redirect } from 'next/navigation';
import { IllustrationPanel } from '@/components/illustrations';
import { Logo } from '@/components/logo';
import { getUser, supabaseServer } from '@/lib/supabase/server';
import { parseScopes } from '@/lib/oauth';
import { ConsentForm } from './consent-form';

export const metadata = { title: 'Connect an app', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | undefined>;

function Problem({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-items-center px-5 text-center">
      <div className="rise">
        <Logo className="mx-auto mb-6 size-12" />
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-fg-3">{detail}</p>
      </div>
    </main>
  );
}

export default async function Authorize({ searchParams }: { searchParams: Promise<Search> }) {
  const q = await searchParams;
  if (q.error === 'invalid_client') return <Problem title="Unknown app" detail="This connection request is not valid. Start again from the app." />;
  if (q.response_type !== 'code' || !q.client_id || !q.redirect_uri) {
    return <Problem title="Invalid request" detail="Missing response_type=code, client_id or redirect_uri." />;
  }

  const sb = await supabaseServer();
  const { data } = await sb.rpc('oauth_client_info', { p_client_id: q.client_id });
  const client = data as { name: string; redirect_uris: string[] } | null;
  if (!client) return <Problem title="Unknown app" detail="This app is not registered. Start again from the app." />;
  // Never redirect anywhere that is not registered for this client.
  if (!client.redirect_uris.includes(q.redirect_uri)) {
    return <Problem title="Redirect not allowed" detail="The return address doesn't match what this app registered." />;
  }
  const fail = (error: string) => {
    const u = new URL(q.redirect_uri!);
    u.searchParams.set('error', error);
    if (q.state) u.searchParams.set('state', q.state);
    redirect(u.toString());
  };
  if (!q.code_challenge || q.code_challenge_method !== 'S256') fail('invalid_request');

  const user = await getUser();
  if (!user) {
    const here = '/oauth/authorize?' + new URLSearchParams(q as Record<string, string>).toString();
    redirect('/?next=' + encodeURIComponent(here));
  }

  const scopes = parseScopes(q.scope);
  const host = new URL(q.redirect_uri).host;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 pb-[calc(24px+var(--safe-bottom))] pt-[calc(32px+var(--safe-top))]">
      <IllustrationPanel name="shield" className="rise mb-7 h-[150px]" />
      <h1 className="rise text-center text-[26px] font-semibold leading-tight tracking-[-0.03em]">
        {client.name} wants to connect to your Slates
      </h1>
      <p className="rise mt-3 text-center text-sm text-fg-3">
        Signed in as <span className="text-fg-2">{user.email}</span>. You&apos;ll return to <span className="text-fg-2">{host}</span>.
      </p>

      <ConsentForm host={host}>
        {(['client_id', 'redirect_uri', 'state', 'code_challenge'] as const).map((k) =>
          q[k] ? <input key={k} type="hidden" name={k} value={q[k]} /> : null,
        )}
        <fieldset>
          <legend className="kicker mb-2">Access</legend>
          <div className="space-y-2">
            {[
              ['write', 'Read & write', 'Create boards, update items, set your brief, notify you'],
              ['read', 'Read only', 'See your boards and activity, change nothing'],
            ].map(([value, label, desc]) => (
              <label key={value} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line p-3 has-[:checked]:border-fg has-[:checked]:bg-muted">
                <input
                  type="radio"
                  name="access"
                  value={value}
                  defaultChecked={value === (scopes.includes('write') ? 'write' : 'read')}
                  className="mt-1 accent-[var(--ink)]"
                />
                <span>
                  <span className="block text-[15px] font-medium">{label}</span>
                  <span className="block text-xs text-fg-3">{desc}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </ConsentForm>
    </main>
  );
}
