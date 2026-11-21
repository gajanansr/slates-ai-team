'use client';
import Link from 'next/link';
import { Bot, User } from 'lucide-react';
import type { Activity } from '@/lib/slates';
import { dayLabel } from '@/lib/time';
import { Ago } from '@/components/time';
import { IllustrationPanel } from '@/components/illustrations';

const VERB: Record<string, string> = {
  created: 'created',
  updated: 'updated',
  archived: 'archived',
  restored: 'restored',
  deleted: 'deleted',
  reordered: 'reordered slates',
  note: 'noted',
  imported: 'imported',
  agent_connected: 'connected an agent',
  agent_revoked: 'revoked an agent',
  reminder_set: 'set a reminder',
  reminder_done: 'completed a reminder',
  reminder_cancelled: 'cancelled a reminder',
  reminded: 'went off',
  notified: 'sent a notification',
  admin_change: 'changed member access',
};

export function ActivityFeed({ items, titles = {} }: { items: Activity[]; titles?: Record<string, string> }) {
  if (items.length === 0) {
    return (
      <div className="card p-4 text-center">
        <IllustrationPanel name="pulse" className="mb-4 h-[150px]" />
        <p className="text-[17px] font-medium tracking-tight">Quiet for now</p>
        <p className="mx-auto mt-1 max-w-[34ch] pb-2 text-sm text-fg-3">Changes by you and your agents show up here, newest first.</p>
      </div>
    );
  }
  const groups: [string, Activity[]][] = [];
  for (const a of items) {
    const label = dayLabel(a.created_at);
    const last = groups.at(-1);
    if (last && last[0] === label) last[1].push(a);
    else groups.push([label, [a]]);
  }
  return (
    <div className="space-y-7">
      {groups.map(([label, list]) => (
        <section key={label}>
          <h2 className="kicker mb-2 px-1" suppressHydrationWarning>
            {label}
          </h2>
          <ul className="card divide-y divide-line">
            {list.map((a) => {
              const who = a.action === 'reminded' ? 'Reminder' : (a.agent_name ?? (a.agent_id ? 'Agent' : 'You'));
              return (
                <li key={a.id} className="flex gap-3 px-4 py-3.5">
                  <span className={`mt-0.5 grid size-8 flex-none place-items-center rounded-full border ${a.agent_name || a.agent_id ? 'border-line bg-muted' : 'border-line'}`}>
                    {a.agent_name || a.agent_id ? <Bot className="size-4 text-fg-2" strokeWidth={1.6} /> : <User className="size-4 text-fg-3" strokeWidth={1.6} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] leading-snug text-fg-2">
                      <span className="font-medium text-fg">{who}</span> {VERB[a.action] ?? a.action}
                      {a.slate_slug && a.action !== 'deleted' && (
                        <>
                          {' '}
                          <Link href={`/s/${a.slate_slug}`} className="text-fg underline decoration-fg-4 underline-offset-[3px]">
                            {titles[a.slate_slug] ?? a.slate_slug}
                          </Link>
                        </>
                      )}
                    </p>
                    {a.summary && <p className="mt-0.5 text-[13px] leading-snug text-fg-3">{a.summary}</p>}
                  </div>
                  <Ago iso={a.created_at} className="shrink-0 pt-0.5 text-xs text-fg-4" />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
