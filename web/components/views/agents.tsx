import Link from 'next/link';
import { ChevronRight, Plus, Sparkles } from 'lucide-react';
import { newPlaybook } from '@/app/(app)/desk-actions';
import { PageHeader } from '@/components/page-header';
import { IllustrationPanel } from '@/components/illustrations';
import { ConnectAgent } from '@/components/agents/connect-agent';
import { RevokeButton } from '@/components/agents/revoke-button';
import { CopyBlock } from '@/components/copy';
import { Ago } from '@/components/time';
import { SITE_URL } from '@/lib/env';
import { TOOLS } from '@/lib/agent/tools';
import { STARTER_MESSAGE } from '@/components/agents/presets';

export type AgentRow = {
  id: string;
  name: string;
  kind: string;
  scopes: string[];
  token_prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  client_id?: string | null;
  expires_at?: string | null;
  boards?: string[] | null;
};

type Report = Record<string, { changes: number; session?: { did: string; open?: string; at?: string } }>;

export function AgentsView({
  agents,
  boards = [],
  report = {},
  handoffs = [],
  playbooks = [],
}: {
  agents: AgentRow[];
  boards?: { slug: string; title: string }[];
  report?: Report;
  handoffs?: { id: string; from: string; to: string; task: string }[];
  playbooks?: { id: string; title: string }[];
}) {
  const active = agents.filter((a) => !a.revoked_at);
  const revoked = agents.filter((a) => a.revoked_at);

  return (
    <>
      <PageHeader back={{ href: '/home', label: 'Back to Today' }} kicker="Connections" title="Agents" sub="Give each agent its own token. Revoke any time." actions={<ConnectAgent cta="Connect" boards={boards} />} />

      <div className="rise-2 space-y-6">
        <Link href="/agents/studio" transitionTypes={['nav-forward']} className="card press flex items-center gap-3.5 p-4">
          <span aria-hidden className="grid size-11 flex-none place-items-center rounded-2xl bg-accent text-on-accent">
            <Sparkles className="size-5" strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15.5px] font-medium tracking-[-0.015em]">New agent</span>
            <span className="block text-[13px] text-fg-3">Say a job, like &ldquo;manage my dairy business&rdquo;, and Slates builds an agent for it.</span>
          </span>
          <ChevronRight className="size-4 flex-none text-fg-4" />
        </Link>

        <details className="card group p-4 sm:p-5" open={active.length === 0}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[15px] font-semibold tracking-tight [&::-webkit-details-marker]:hidden">
            How agents work
            <span className="text-[13px] font-normal text-fg-3 group-open:hidden">Show</span>
          </summary>
          <p className="mt-2 text-sm leading-relaxed text-fg-2">
            An agent is an AI assistant you already use, like Claude, ChatGPT or Instinct. Connect it once and it can make boards, tick off lists, add
            reminders and write notes for you. Everything it changes shows up in Activity, and every board keeps a history you can restore.
          </p>
          <ol className="mt-3 space-y-2 text-sm text-fg-2">
            {[
              'Tap Connect and pick your assistant.',
              'Follow its steps: sign in to Slates (Claude, ChatGPT, Grok), or paste the token it gives you.',
              'Send your agent the starter message below, so it knows what to do.',
            ].map((t, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="grid size-6 flex-none place-items-center rounded-full bg-accent text-[12px] font-semibold text-on-accent">{i + 1}</span>
                <span className="pt-0.5">{t}</span>
              </li>
            ))}
          </ol>
          <div className="mt-4">
            <CopyBlock label="Starter message for your agent" text={STARTER_MESSAGE} />
          </div>
          <p className="mt-2 text-xs text-fg-3">Read only access lets an agent look without changing anything. You can limit it to some boards, set an expiry, and revoke it any time.</p>
        </details>

        {active.length === 0 ? (
          <div className="card p-4 text-center">
            <IllustrationPanel name="connect" className="mb-4 h-[150px]" />
            <p className="text-[15px] font-medium">No agents connected</p>
            <p className="mx-auto mt-1.5 max-w-[40ch] text-sm text-fg-3">
              Connect Instinct, Claude, Grok or any bot. They get tools to create sections, update your brief and log what
              they did.
            </p>
            <div className="h-2" />
          </div>
        ) : (
          <ul className="card divide-y divide-line">
            {active.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-3.5">
                <span className="grid size-10 flex-none place-items-center rounded-2xl border border-line bg-muted text-sm font-semibold">
                  {a.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium">{a.name}</p>
                  <p className="truncate text-xs text-fg-3">
                    <span className="hidden font-mono sm:inline">{a.token_prefix}… · </span>
                    {a.client_id ? 'OAuth · ' : ''}
                    {a.scopes.includes('write') ? 'Read & write' : 'Read only'}
                    {a.boards?.length ? ` · ${a.boards.length} board${a.boards.length === 1 ? '' : 's'}` : ''}
                    {' · '}
                    {a.last_used_at ? (
                      <>
                        used <Ago iso={a.last_used_at} />
                      </>
                    ) : (
                      'never used'
                    )}
                    {a.expires_at && (
                      <>
                        {' · '}
                        {new Date(a.expires_at) < new Date() ? 'expired' : `expires ${new Date(a.expires_at).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                      </>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-fg-3 [overflow-wrap:anywhere]">
                    {report[a.name]?.changes ?? 0} change{report[a.name]?.changes === 1 ? '' : 's'} this week
                    {report[a.name]?.session && <> · last session: {report[a.name].session!.did}</>}
                  </p>
                  {report[a.name]?.session?.open && <p className="text-xs text-fg-3 [overflow-wrap:anywhere]">Still open: {report[a.name].session!.open}</p>}
                </div>
                <RevokeButton id={a.id} name={a.name} />
              </li>
            ))}
          </ul>
        )}

        {handoffs.length > 0 && (
          <section>
            <h2 className="kicker mb-2 px-1">Between agents</h2>
            <ul className="card divide-y divide-line">
              {handoffs.map((h) => (
                <li key={h.id} className="px-4 py-3">
                  <p className="text-xs text-fg-3">{h.from} → {h.to}</p>
                  <p className="text-[14.5px] leading-snug [overflow-wrap:anywhere]">{h.task}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="kicker mb-2 px-1">Playbooks</h2>
          <div className="card divide-y divide-line">
            {playbooks.map((p) => (
              <Link key={p.id} href={`/notes/${encodeURIComponent(p.id)}`} className="flex items-center gap-3 px-4 py-3.5">
                <span className="min-w-0 flex-1 truncate text-[15px]">{p.title}</span>
                <ChevronRight className="size-4 flex-none text-fg-4" />
              </Link>
            ))}
            <form action={newPlaybook}>
              <button type="submit" className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-[15px] text-fg-2">
                <Plus className="size-4 flex-none text-fg-3" /> New playbook
              </button>
            </form>
          </div>
          <p className="mt-2 px-1 text-xs leading-relaxed text-fg-3">Write once how you want a job done (weekly review, logging expenses). Every agent follows it.</p>
        </section>

        <section className="card space-y-4 p-4 sm:p-5">
          <h2 className="text-[15px] font-semibold tracking-tight">Endpoints</h2>
          <CopyBlock label="MCP (Streamable HTTP)" text={`${SITE_URL}/mcp`} />
          <p className="text-xs leading-relaxed text-fg-3">
            claude.ai and ChatGPT: add a custom connector with this URL and sign in when asked. No token needed.
          </p>
          <CopyBlock label="REST + OpenAPI" text={`${SITE_URL}/api/v1/openapi.json`} />
          <details className="text-xs text-fg-3">
            <summary className="cursor-pointer select-none py-1 font-medium text-fg-2">{TOOLS.length} tools agents can use</summary>
            <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11.5px]">
              {TOOLS.map((t) => (
                <li key={t.name} className="truncate">
                  {t.name}
                </li>
              ))}
            </ul>
            <p className="mt-2">
              Full guide:{' '}
              <a href="/llms.txt" className="underline underline-offset-2">
                /llms.txt
              </a>
            </p>
          </details>
        </section>

        {revoked.length > 0 && (
          <details className="px-1 text-sm text-fg-3">
            <summary className="cursor-pointer select-none py-2">Revoked ({revoked.length})</summary>
            <ul className="mt-2 space-y-1">
              {revoked.map((a) => (
                <li key={a.id} className="flex justify-between">
                  <span>{a.name}</span>
                  <span className="text-fg-4">
                    revoked <Ago iso={a.revoked_at!} />
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </>
  );
}
