'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, Plus, ShieldCheck } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { CopyBlock } from '@/components/copy';
import { createAgent } from '@/app/(app)/actions';
import { AGENT_PRESETS, METHOD_LABEL, STARTER_MESSAGE, pairMessage, snippet, type Method } from '@/components/agents/presets';

export function ConnectAgent({ cta = 'Connect agent', boards = [] }: { cta?: string; boards?: { slug: string; title: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('instinct');
  const preset = useMemo(() => AGENT_PRESETS.find((p) => p.kind === kind) ?? AGENT_PRESETS[0], [kind]);
  const [method, setMethod] = useState<Method>(preset.methods[0]);
  const [name, setName] = useState(preset.name);
  const [readOnly, setReadOnly] = useState(false);
  const [days, setDays] = useState<number | null>(null);
  const [limit, setLimit] = useState<string[] | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  const pick = (k: string) => {
    const p = AGENT_PRESETS.find((x) => x.kind === k)!;
    setKind(k);
    setName(p.kind === 'other' ? '' : p.name);
    setMethod(p.methods[0]);
    setToken(null);
    setError('');
  };
  const close = () => {
    setOpen(false);
    setToken(null);
    setError('');
    router.refresh();
  };
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> {cta}
      </button>
      <Sheet open={open} onClose={close} title={token ? `${name || preset.name} is ready` : 'Connect an agent'}>
        <div className="space-y-5">
          {!token && (
            <div>
              <p className="kicker mb-2">Agent</p>
              <div className="flex flex-wrap gap-2">
                {AGENT_PRESETS.map((p) => (
                  <button
                    key={p.kind}
                    type="button"
                    onClick={() => pick(p.kind)}
                    className={`h-9 rounded-full border px-3.5 text-sm transition-all active:scale-95 ${
                      kind === p.kind ? 'border-btn bg-btn text-on-btn' : 'border-line text-fg-2'
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {preset.methods.length > 1 && (
            <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1" role="tablist" aria-label="Connection method">
              {preset.methods.map((m, i) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={method === m}
                  onClick={() => setMethod(m)}
                  className={`h-8 shrink-0 rounded-full px-3 text-[13px] transition-colors ${method === m ? 'bg-btn text-on-btn' : 'bg-muted text-fg-2'}`}
                >
                  {METHOD_LABEL[m]}
                  {i === 0 && <span className={method === m ? 'text-on-btn/60' : 'text-fg-4'}> · best</span>}
                </button>
              ))}
            </div>
          )}

          {preset.note && <p className="text-xs leading-relaxed text-fg-3">{preset.note}</p>}

          {method === 'pair' ? (
            <div className="space-y-4">
              <ol className="space-y-2.5">
                {['Copy the message below and paste it to your agent', 'It shows you a short code and a link', 'Open the link, check the code and tap Allow'].map((t, i) => (
                  <li key={i} className="flex gap-3 text-sm text-fg-2">
                    <span className="grid size-6 flex-none place-items-center rounded-full border border-line font-mono text-[11px] text-fg-3">{i + 1}</span>
                    <span className="pt-0.5">{t}</span>
                  </li>
                ))}
              </ol>
              <CopyBlock label="Paste this to your agent" text={pairMessage(origin)} />
              <p className="flex items-start gap-2 text-xs leading-relaxed text-fg-3">
                <ShieldCheck className="mt-0.5 size-3.5 flex-none" strokeWidth={1.75} />
                No token to copy. You choose access, expiry and boards when you tap Allow, and the agent shows up here once paired.
              </p>
              <button type="button" className="btn btn-glass w-full" onClick={close}>
                Done
              </button>
            </div>
          ) : method === 'connector' ? (
            <div className="space-y-4">
              <ol className="space-y-2.5">
                {(preset.connectorSteps ?? []).map((s, i) => (
                  <li key={i} className="flex gap-3 text-sm text-fg-2">
                    <span className="grid size-6 flex-none place-items-center rounded-full border border-line font-mono text-[11px] text-fg-3">{i + 1}</span>
                    <span className="pt-0.5">{s}</span>
                  </li>
                ))}
              </ol>
              <CopyBlock label="Connector URL" text={`${origin}/mcp`} />
              <p className="flex items-start gap-2 text-xs leading-relaxed text-fg-3">
                <ShieldCheck className="mt-0.5 size-3.5 flex-none" strokeWidth={1.75} />
                No token to copy. You choose read or write on the Slates consent screen, and it appears here once connected.
              </p>
              <CopyBlock label="Then send your agent this" text={STARTER_MESSAGE} />
              <button type="button" className="btn btn-glass w-full" onClick={close}>
                Done
              </button>
            </div>
          ) : !token ? (
            <form
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  const r = await createAgent(name, kind, readOnly, { days, boards: limit });
                  if (r.ok && r.data) setToken(r.data.token);
                  else if (!r.ok) setError(r.error);
                });
              }}
            >
              <label className="block">
                <span className="kicker mb-2 block">Name</span>
                <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Morning brief bot" />
              </label>
              <fieldset>
                <legend className="kicker mb-2">Access</legend>
                <div className="grid grid-cols-2 gap-2 [&>*]:min-w-0">
                  {(
                    [
                      [false, 'Read & write', 'Create and update boards'],
                      [true, 'Read only', 'Look, never touch'],
                    ] as const
                  ).map(([ro, t, d]) => (
                    <button
                      key={String(ro)}
                      type="button"
                      onClick={() => setReadOnly(ro)}
                      className={`rounded-2xl border p-3 text-left transition-colors ${readOnly === ro ? 'border-fg bg-muted' : 'border-line'}`}
                    >
                      <span className="block text-sm font-medium">{t}</span>
                      <span className="block text-xs text-fg-3">{d}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="kicker mb-2">Expires</legend>
                <div className="flex flex-wrap gap-1.5">
                  {([[null, 'Never'], [30, '30 days'], [90, '90 days'], [365, '1 year']] as const).map(([d, t]) => (
                    <button key={t} type="button" onClick={() => setDays(d)} aria-pressed={days === d} className={`h-9 rounded-full border px-3.5 text-[13px] ${days === d ? 'border-fg bg-muted font-medium' : 'border-line text-fg-3'}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </fieldset>
              {boards.length > 0 && (
                <fieldset>
                  <legend className="kicker mb-2">Boards</legend>
                  <div className="mb-2 grid grid-cols-2 gap-2">
                    {([[false, 'All boards'], [true, 'Only some']] as const).map(([some, t]) => (
                      <button key={t} type="button" onClick={() => setLimit(some ? (limit ?? []) : null)} className={`rounded-2xl border p-3 text-left text-sm font-medium ${(limit !== null) === some ? 'border-fg bg-muted' : 'border-line'}`}>
                        {t}
                      </button>
                    ))}
                  </div>
                  {limit !== null && (
                    <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-2xl border border-line p-1.5">
                      {boards.map((b) => (
                        <label key={b.slug} className="flex h-10 items-center gap-2.5 rounded-xl px-2 text-sm active:bg-muted">
                          <input
                            type="checkbox"
                            className="size-4 accent-[var(--ink)]"
                            checked={limit.includes(b.slug)}
                            onChange={(e) => setLimit(e.target.checked ? [...limit, b.slug] : limit.filter((x) => x !== b.slug))}
                          />
                          <span className="truncate">{b.title}</span>
                        </label>
                      ))}
                      <p className="px-2 pb-1 pt-1.5 text-xs text-fg-4">The agent sees and edits only these. Include Notes for note tools.</p>
                    </div>
                  )}
                </fieldset>
              )}
              {error && <p className="text-sm text-fg">{error}</p>}
              <button className="btn btn-primary w-full" disabled={pending || !name.trim() || (limit !== null && limit.length === 0)}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" strokeWidth={1.75} />}
                Create token
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="flex gap-3 rounded-2xl border border-line bg-muted p-3.5">
                <ShieldCheck className="mt-0.5 size-5 flex-none text-fg" strokeWidth={1.6} />
                <p className="text-sm leading-relaxed text-fg-2">
                  Shown <span className="text-fg">once</span>. Give it to the agent now; you can revoke it any time.
                </p>
              </div>
              {(() => {
                const s = snippet(method as Exclude<Method, 'connector' | 'pair'>, origin, token);
                return (
                  <div>
                    <p className="mb-2 text-xs leading-relaxed text-fg-3">{s.hint}</p>
                    <CopyBlock text={s.text} />
                  </div>
                );
              })()}
              <CopyBlock label="Token only" text={token} />
              <CopyBlock label="Then send your agent this" text={STARTER_MESSAGE} />
              <button type="button" className="btn btn-glass w-full" onClick={close}>
                Done
              </button>
            </div>
          )}
        </div>
      </Sheet>
    </>
  );
}
