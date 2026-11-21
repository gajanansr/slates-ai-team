'use client';
import { useState, useTransition } from 'react';
import { Inbox, Loader2, Newspaper, Play, Rss, SlidersHorizontal, Sparkles, Sun, Trash2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { FEED_SIZES, FEED_SOURCES, HN_LISTS, HN_MIN_SCORES } from '@/lib/feed-sources';
import type { Automation, AutomationKind } from '@/lib/automations';
import { deleteAutomation, runAutomationNow, saveAutomation } from '@/app/(app)/feature-actions';
import { Sheet } from '@/components/ui/sheet';
import { Ago } from '@/components/time';
import { Select } from '@/components/ui/select';

type Def = { kind: AutomationKind; title: string; blurb: string; icon: typeof Sun; every: Automation['every']; hour?: number; weekday?: number; ai?: boolean; fields?: { key: string; label: string; placeholder: string }[] };
const DEFS: Def[] = [
  { kind: 'brief', title: 'Morning brief', blurb: "Builds today's brief from your reminders and boards.", icon: Sun, every: 'daily', hour: 7, ai: true },
  { kind: 'recap', title: 'Weekly recap', blurb: 'Sunday evening: what got done, what moved, what is next. Saved to Notes.', icon: Newspaper, every: 'weekly', hour: 19, weekday: 0, ai: true },
  { kind: 'inbox', title: 'Auto-file Inbox', blurb: 'Every few hours, files Inbox items into the right boards.', icon: Inbox, every: 'hourly', ai: true },
  { kind: 'rss', title: 'RSS feed', blurb: 'Newest posts from a blog or news feed as a links board.', icon: Rss, every: 'hourly' },
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const when = (a: { every: string; at_hour: number | null; at_weekday: number | null }) =>
  a.every === 'hourly' ? 'Every hour' : `${a.every === 'weekly' ? `${DAYS[a.at_weekday ?? 0]}s` : 'Daily'} at ${String(a.at_hour ?? 7).padStart(2, '0')}:00`;

export function AutomationsView({
  items,
  ready,
}: {
  items: Automation[];
  ready: { ai: boolean; jev?: boolean; enc: boolean };
}) {
  const [adding, setAdding] = useState<Def | null>(null);
  const [editing, setEditing] = useState<Automation | null>(null);
  return (
    <div className="space-y-6">
      {!ready.enc && <p className="rounded-2xl bg-muted px-4 py-3 text-sm">Automations are waiting for one server setting.</p>}

      {items.length > 0 && (
        <section>
          <h2 className="kicker mb-2 px-1">Running</h2>
          <ul className="card divide-y divide-line">
            {items.map((a) => (
              <Row key={a.id} a={a} onEdit={() => setEditing(a)} />
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="kicker mb-2 px-1">Add</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {DEFS.map((d) => {
            const noAi = d.ai && !ready.ai && !(d.kind === 'inbox' && ready.jev);
            const blocked = Boolean(noAi || !ready.enc);
            const why = noAi ? 'Needs Ask Slates' : '';
            return (
              <li key={d.kind}>
                <button type="button" disabled={blocked} onClick={() => setAdding(d)} className="card flex h-full w-full items-start gap-3 p-4 text-left disabled:opacity-55">
                  <d.icon className="mt-0.5 size-5 flex-none" strokeWidth={1.6} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-[15px] font-medium">
                      {d.title}
                      {d.ai && <Sparkles className="size-3.5 text-fg-3" strokeWidth={1.8} />}
                    </span>
                    <span className="mt-0.5 block text-[13px] leading-snug text-fg-3">{why || d.blurb}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>


      <AddSheet def={adding} onClose={() => setAdding(null)} />
      <AddSheet key={editing?.id ?? 'none'} def={editing ? (DEFS.find((d) => d.kind === editing.kind) ?? null) : null} existing={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function Row({ a, onEdit }: { a: Automation; onEdit: () => void }) {
  const [pending, start] = useTransition();
  const [running, startRun] = useTransition();
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const def = DEFS.find((d) => d.kind === a.kind)!;
  const go = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      setError(r.ok ? '' : (r.error ?? 'Failed'));
    });
  const notify = a.config?.notify !== false;
  return (
    <li className="p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-10 flex-none place-items-center rounded-2xl bg-muted">
          <def.icon className="size-[18px] text-fg-2" strokeWidth={1.7} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">{a.title}</span>
          <span className="line-clamp-2 block text-xs leading-snug text-fg-3">
            {a.enabled ? when(a) : 'Paused'}
            {a.last_run_at && (
              <>
                {' · ran '}
                <Ago iso={a.last_run_at} />
                {a.last_status === 'error' ? ' · failed' : a.last_status === 'skipped' ? ' · nothing new' : ''}
              </>
            )}
          </span>
        </span>
        <button
          type="button"
          disabled={pending || running}
          onClick={() =>
            startRun(async () => {
              setError('');
              setDone('');
              const r = await runAutomationNow(a.id);
              if (r.ok) setDone(r.message);
              else setError(r.error);
            })
          }
          className="btn btn-primary h-9 flex-none px-3 text-[13px]"
        >
          {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" strokeWidth={2} />} {running ? 'Running' : 'Run'}
        </button>
      </div>
      {a.last_status === 'error' && a.last_error && !done && !error && <p className="mt-2.5 rounded-xl bg-muted px-3 py-2 text-[12.5px] leading-snug text-fg-2">{a.last_error}</p>}
      {done && <p className="mt-2.5 rounded-xl bg-new/12 px-3 py-2 text-[12.5px] text-fg">{done}</p>}
      {error && <p className="mt-2.5 rounded-xl bg-muted px-3 py-2 text-[12.5px] leading-snug text-fg">{error}</p>}
      <div className="mt-3 flex items-center gap-4 border-t border-line pt-3">
        <Switch
          on={a.enabled}
          disabled={pending}
          label="Active"
          onChange={(v) => go(() => saveAutomation({ id: a.id, kind: a.kind, title: a.title, every: a.every, enabled: v }))}
        />
        <Switch
          on={notify}
          disabled={pending}
          label="Notify"
          onChange={(v) => go(() => saveAutomation({ id: a.id, kind: a.kind, title: a.title, every: a.every, config: { ...a.config, notify: v } }))}
        />
        <button type="button" className="btn btn-glass btn-icon ml-auto size-8 flex-none" aria-label={`Edit ${a.title}`} disabled={pending} onClick={onEdit}>
          <SlidersHorizontal className="size-3.5" strokeWidth={1.8} />
        </button>
        <button type="button" className="btn btn-glass btn-icon size-8 flex-none" aria-label={`Remove ${a.title}`} disabled={pending} onClick={() => go(() => deleteAutomation(a.id))}>
          <Trash2 className="size-3.5" strokeWidth={1.8} />
        </button>
      </div>
    </li>
  );
}

function AddSheet({ def, onClose, existing = null }: { def: Def | null; onClose: () => void; existing?: Automation | null }) {
  const [title, setTitle] = useState(existing?.title ?? '');
  const [hour, setHour] = useState(existing?.at_hour ?? 7);
  const [weekday, setWeekday] = useState(existing?.at_weekday ?? 0);
  const [config, setConfig] = useState<Record<string, any>>(() => {
    const c = { ...(existing?.config ?? {}) };
    // Older Hacker News automations used an hnrss address; show them as the Hacker News source.
    if (existing?.kind === 'rss' && !c.source && /hnrss\.org|news\.ycombinator\.com/.test(String(c.url ?? ''))) {
      c.source = 'hn';
      delete c.url;
    }
    if (existing?.kind === 'rss' && !c.source && c.url) c.source = 'other';
    return c;
  });
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const d = def;
  return (
    <Sheet open={Boolean(d)} onClose={onClose} title={existing ? `Edit ${existing.title}` : (d?.title ?? '')}>
      {d && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const cfg = d.kind === 'rss' ? { ...config, source: config.source ?? 'hn' } : config;
              const src = FEED_SOURCES.find((f) => f.id === cfg.source);
              const name = title.trim() || (d.kind === 'rss' ? (src?.name ?? (cfg.url ? cfg.url.replace(/^https?:\/\//, '').split('/')[0] : d.title)) : d.title);
              const r = await saveAutomation({ id: existing?.id, kind: d.kind, title: name, every: existing?.every ?? d.every, at_hour: d.every === 'hourly' ? null : hour, at_weekday: d.every === 'weekly' ? weekday : null, config: cfg.source === 'other' ? { url: cfg.url ?? '', max: cfg.max, notify: cfg.notify } : cfg });
              if (!r.ok) return setError(r.error);
              if (!existing) {
                setTitle('');
                setConfig({});
              }
              setError('');
              onClose();
            });
          }}
        >
          <p className="text-sm text-fg-3">{d.blurb}</p>
          {d.kind === 'rss' && (
            <>
              <div>
                <p className="kicker mb-2">Source</p>
                <Select
                  label="Source"
                  value={config.source ?? 'hn'}
                  onChange={(v) => setConfig({ ...config, source: v, url: v === 'other' ? (config.url ?? '') : '' })}
                  options={[...FEED_SOURCES.map((f) => ({ value: f.id as string, label: f.name, hint: f.hint })), { value: 'other', label: 'Another website…', hint: 'Paste its address' }]}
                />
              </div>
              {(config.source ?? 'hn') === 'hn' && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <p className="kicker mb-2">Which posts</p>
                    <Select label="Which posts" value={config.hn_list ?? 'top'} onChange={(v) => setConfig({ ...config, hn_list: v })} options={HN_LISTS.map((x) => ({ ...x }))} />
                  </div>
                  <div className="min-w-0">
                    <p className="kicker mb-2">Only</p>
                    <Select label="Points filter" value={Number(config.min_score ?? 0)} onChange={(v) => setConfig({ ...config, min_score: v })} options={HN_MIN_SCORES.map((x) => ({ ...x }))} />
                  </div>
                  <div className="min-w-0">
                    <p className="kicker mb-2">Keep</p>
                    <Select label="How many" value={Number(config.max ?? 20)} onChange={(v) => setConfig({ ...config, max: v })} options={FEED_SIZES.map((x) => ({ ...x }))} />
                  </div>
                </div>
              )}
              {config.source && config.source !== 'hn' && config.source !== 'other' && (
                <div>
                  <p className="kicker mb-2">Keep</p>
                  <Select label="How many" value={Number(config.max ?? 20)} onChange={(v) => setConfig({ ...config, max: v })} options={FEED_SIZES.map((x) => ({ ...x }))} />
                </div>
              )}
              {config.source === 'other' && (
                <label className="block">
                  <span className="kicker mb-2 block">Website or feed address</span>
                  <input
                    className="field"
                    value={config.url ?? ''}
                    onChange={(e) => setConfig({ ...config, url: e.target.value })}
                    placeholder="theverge.com"
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                  />
                  <span className="mt-1.5 block text-xs text-fg-3">Most sites work with just their address. Slates finds the feed for you.</span>
                </label>
              )}
              <label className="block">
                <span className="kicker mb-2 block">Board name</span>
                <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={FEED_SOURCES.find((f) => f.id === (config.source ?? 'hn'))?.name ?? 'e.g. Tech news'} maxLength={80} />
              </label>
            </>
          )}
          {d.every !== 'hourly' && (
            <div className="flex gap-2">
              {d.every === 'weekly' && (
                <div className="min-w-0 flex-1">
                  <p className="kicker mb-2">Day</p>
                  <Select label="Day" value={weekday} onChange={setWeekday} options={DAYS.map((x, i) => ({ value: i, label: x }))} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="kicker mb-2">Time</p>
                <Select
                  label="Time"
                  value={hour}
                  onChange={setHour}
                  options={Array.from({ length: 24 }, (_, h) => ({ value: h, label: new Date(2000, 0, 1, h).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' }).toLowerCase() }))}
                />
              </div>
            </div>
          )}
          <p className="text-xs text-fg-3">
            {d.ai ? 'Runs as your built-in “Slates” agent, so changes show up in Activity and on Home under “Since you last looked”. ' : 'Updates show up on Home under “Since you last looked”. '}
            You get a notification when it finds something new. You can turn that off on the automation.
          </p>
          {error && <p className="text-sm">{error}</p>}
          <button className="btn btn-primary w-full" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />} {existing ? 'Save' : 'Turn on'}
          </button>
        </form>
      )}
    </Sheet>
  );
}

