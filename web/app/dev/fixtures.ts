import { EXAMPLES } from '@/lib/kinds';
const EXAMPLES_DASH = EXAMPLES.dashboard;
import type { Slate } from '@/lib/kinds';
import type { Activity } from '@/lib/slates';

const now = Date.now();
const t = (mins: number) => new Date(now - mins * 60000).toISOString();
let n = 0;
const slate = (p: Partial<Slate> & Pick<Slate, 'slug' | 'title' | 'kind' | 'data'>): Slate => ({
  id: `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`,
  icon: null, category: null, position: n, pinned: false, hidden: false, archived_at: null, version: 3,
  created_by: null, updated_by: null, updated_by_name: null, created_at: t(9000), updated_at: t(n * 37),
  ...p,
});

export const FIXTURE_SLATES: Slate[] = [
  slate({ slug: 'today', title: 'Today', kind: 'brief', pinned: true, updated_by_name: 'Instinct', updated_by: 'x',
    data: { date: 'Tuesday 3 November', headline: 'Ship the quarterly review deck and clear the two overdue payments before 6pm',
      items: [
        { id: 'a', text: 'Pay the credit card minimum before the due date', tone: 'bad' },
        { id: 'b', text: 'Review pull request #482 from the platform team', tone: 'warn' },
        { id: 'c', text: 'Gym, 7pm', tone: 'good', done: true },
        { id: 'd', text: 'Call the bank about the statement discrepancy on the second account' },
      ] } }),
  slate({ category: 'Money', slug: 'money', title: 'Money', kind: 'metrics', pinned: true, updated_by_name: 'Claude', updated_by: 'x',
    data: { asOf: '3 Nov', items: [
      { id: '1', label: 'Salary', value: '₹1,00,000' },
      { id: '2', label: 'Committed this month', value: '₹1,24,500', sub: 'rent, EMIs, card minimums' },
      { id: '3', label: 'Gap', value: '-₹24,500', tone: 'bad' },
      { id: '4', label: 'Savings goal', value: '58%', progress: 58, tone: 'good', trend: [31, 36, 35, 42, 47, 51, 58] },
    ] } }),
  slate({ slug: 'reading-list-with-a-very-long-title-that-should-truncate', title: 'Reading list with a very long title that should truncate nicely on phones', kind: 'list', updated_by_name: 'Grok', updated_by: 'x',
    data: { items: [
      { id: '1', text: 'The Pragmatic Programmer', meta: '42%' },
      { id: '2', text: 'Thinking, Fast and Slow — Daniel Kahneman, chapters 4 to 9', meta: 'next', detail: 'Recommended by a friend' },
      { id: '3', text: 'Designing Data-Intensive Applications', done: true },
      { id: '4', text: 'Reel idea: why your agents need a dashboard', href: 'https://example.com/source', meta: 'Hook: 3s cold open · Effort: medium · Format: talking head + screen capture · Length 45-60s · Post Tue/Thu', detail: 'Script: open on a messy desktop with ten tabs of agent output. Cut to Slates on the phone, everything in one calm place. Walk through the brief, a reminder going off, and a dashboard an agent built overnight. Close with the invite link and a one-line promise. B-roll: hands tapping the Today list, the lime Accept invite button, a chart animating in.' },
    ] } }),
  slate({ category: 'Money', slug: 'bills', title: 'Bills & EMIs', kind: 'table',
    data: { columns: [{ key: 'item', label: 'Item' }, { key: 'detail', label: 'Detail' }, { key: 'due', label: 'Due' }, { key: 'amt', label: 'Amount', align: 'end' }],
      rows: [
        { id: 'r1', cells: { item: 'Home loan EMI', detail: 'Bank, 14 of 240', due: '5 Nov', amt: '₹32,400' } },
        { id: 'r2', cells: { item: 'Broadband', detail: 'Monthly', due: '12 Nov', amt: '₹999' } },
        { id: 'r3', cells: { item: 'Car insurance renewal (comprehensive)', detail: 'Annual', due: '28 Nov', amt: '₹18,250' } },
      ] } }),
  slate({ category: 'Work', slug: 'links', title: 'Dashboards', kind: 'links',
    data: { items: [
      { id: '1', title: 'Analytics overview', url: 'https://example.com/analytics/overview/q4' },
      { id: '2', title: 'A dashboard with an extremely long name that keeps going', url: 'https://docs.example.com/x', detail: 'Shared drive · updated weekly by the ops team' },
    ] } }),
  slate({ category: 'Work', slug: 'history', title: 'Work history', kind: 'timeline', updated_by_name: 'Dots', updated_by: 'x',
    data: { entries: [
      { id: 'd1', date: '3 Nov', title: 'Slates v2', items: ['Shipped Next.js rebuild', 'Migrated data into typed slates'] },
      { id: 'd2', date: '2 Nov', items: ['Wired Google OAuth', 'Domain moved to the new project'] },
    ] } }),
  slate({ slug: 'plan-doc', title: 'Plan', kind: 'markdown',
    data: { body: '## Plan\n- Agents own sections\n- **Phone first**, desktop second\n\nSee [the docs](https://example.com).' } }),
];

FIXTURE_SLATES.push(
  slate({ category: 'Launchreel', slug: 'launch', title: 'Launchreel', kind: 'dashboard', updated_by_name: 'Instinct', updated_by: 'x',
    data: {
      ...(EXAMPLES_DASH as any),
      widgets: [
        ...((EXAMPLES_DASH as any).widgets ?? []),
        { id: 'pipe', title: 'Pipeline', kind: 'tracker', width: 'half', data: (EXAMPLES as any).tracker },
        { id: 'hab', title: 'Habits', kind: 'habits', width: 'half', data: (EXAMPLES as any).habits },
      ].slice(0, 12),
    } }),
  slate({ category: 'Money', slug: 'spend', title: 'Monthly spend', kind: 'chart', updated_by_name: 'Claude', updated_by: 'x',
    data: { type: 'bar', labels: ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'], series: [{ id: 's', name: 'Spend', values: [82000, 104000, 76000, 118000, 104800, 64000] }], prefix: '₹', caption: 'November so far' } }),
  slate({ category: 'Health', slug: 'sleep', title: 'Sleep vs steps', kind: 'chart',
    data: { type: 'line', labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], series: [{ id: 'a', name: 'This week', values: [6.5, 7.1, 5.8, 7.4, 6.9, 8.2, 7.6] }, { id: 'b', name: 'Last week', values: [6.1, 6.4, 6.8, 6.2, 7.0, 7.5, 7.9] }], suffix: 'h' } }),
  slate({ category: 'Money', slug: 'split', title: 'Where it went', kind: 'chart',
    data: { type: 'parts', labels: ['Food & groceries', 'Travel', 'Bills', 'Other'], series: [{ id: 'p', name: 'Spend', values: [398, 336, 210, 104] }], prefix: '€' } }),
);

export const FIXTURE_ACTIVITY: Activity[] = [
  { id: 5, agent_id: 'x', agent_name: 'Instinct', slate_id: null, slate_slug: 'today', action: 'updated', summary: 'Updated the daily brief', created_at: t(3) },
  { id: 4, agent_id: 'x', agent_name: 'Claude', slate_id: null, slate_slug: 'money', action: 'updated', summary: 'upserted 2 items', created_at: t(40) },
  { id: 3, agent_id: null, agent_name: null, slate_id: null, slate_slug: 'reading-list', action: 'updated', summary: 'Ticked an item', created_at: t(200) },
  { id: 2, agent_id: 'x', agent_name: 'Grok', slate_id: null, slate_slug: null, action: 'note', summary: 'Synced 12 tasks from Google Tasks into the reading list and archived 3 finished ones', created_at: t(1600) },
  { id: 1, agent_id: null, agent_name: null, slate_id: null, slate_slug: null, action: 'agent_connected', summary: 'Connected agent Instinct', created_at: t(3000) },
];

export const FIXTURE_AGENTS = [
  { id: 'a1', name: 'Instinct', kind: 'instinct', scopes: ['read', 'write'], token_prefix: 'slt_3f9a2c1b', last_used_at: t(3), revoked_at: null, created_at: t(4000) },
  { id: 'a2', name: 'Morning brief bot with a long name', kind: 'other', scopes: ['read'], token_prefix: 'slt_77aa01fe', last_used_at: null, revoked_at: null, created_at: t(5000) },
];

import type { Reminder } from '@/lib/reminders';
const rem = (id: string, text: string, mins: number, extra: Partial<Reminder> = {}): Reminder => ({
  id, text, due_at: new Date(Date.now() + mins * 60000).toISOString(), tz: 'Asia/Kolkata', repeat: null, slate_slug: null,
  notify_at: null, sent_at: null, done_at: null, created_by: null, created_by_name: null, created_at: t(100), ...extra,
});
export const FIXTURE_REMINDERS: Reminder[] = [
  rem('r1', 'Pay electricity bill', -20, { created_by_name: 'Instinct' }),
  rem('r2', 'Call the bank about the statement', 90),
  rem('r3', 'Take vitamins', 30, { repeat: 'daily' }),
  rem('r4', 'Renew car insurance', 60 * 26, { created_by_name: 'Claude' }),
  rem('r5', 'Team retro notes', 60 * 24 * 4, { repeat: 'weekly' }),
];

const days = Array.from({ length: 30 }, (_, i) => new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10));
export const FIXTURE_ADMIN_STATS = {
  days: 30,
  daily: days.map((d, i) => ({ day: d, visitors: 6 + Math.round(5 * Math.sin(i / 3)) + Math.floor(i / 4), views: 30 + i * 2, users: 2 + (i % 4 === 0 ? 1 : 0) })),
  totals: { views: 1460, visitors: 212, users: 9, new_users: 4, dau: 3, wau: 6, mau: 8, installed_share: 64 },
  top_paths: [{ path: '/home', views: 610 }, { path: '/', views: 290 }, { path: '/s/:slug', views: 270 }, { path: '/boards', views: 140 }, { path: '/reminders', views: 88 }],
  referrers: [{ referrer: 'claude.ai', visitors: 22 }, { referrer: 'x.com', visitors: 9 }, { referrer: 'github.com', visitors: 4 }],
  devices: [{ device: 'mobile', visitors: 150 }, { device: 'desktop', visitors: 55 }, { device: 'tablet', visitors: 7 }],
  countries: [{ country: 'IN', visitors: 160 }, { country: 'US', visitors: 31 }, { country: 'PT', visitors: 12 }],
  signups_weekly: Array.from({ length: 12 }, (_, i) => ({ week: new Date(Date.now() - (11 - i) * 7 * 86400000).toLocaleDateString('en', { day: '2-digit', month: 'short' }), users: [0, 0, 1, 0, 0, 1, 0, 2, 0, 1, 2, 2][i] })),
  agents: { active: 7, by_kind: [{ kind: 'instinct', agents: 3 }, { kind: 'claude', agents: 2 }, { kind: 'oauth', agents: 1 }, { kind: 'grok', agents: 1 }], writes: 340 },
  content: { slates: 41, by_kind: [{ kind: 'list', slates: 12 }, { kind: 'metrics', slates: 9 }, { kind: 'chart', slates: 7 }, { kind: 'links', slates: 6 }], reminders_open: 23, reminders_fired: 58, notifications: 17, push_devices: 6 },
  invites: { sent: 5, accepted: 3, pending: 0, inviters: 3 },
};
export const FIXTURE_ADMIN_USERS = [
  { id: 'u1', email: 'owner@example.com', created_at: t(60 * 24 * 40), last_sign_in_at: t(5), role: 'admin', can_invite: true, invite_quota: 5, invited_by: null, invites_used: 3, slates: 14, agents: 3, reminders_open: 6, push_devices: 2, last_seen: t(2) },
  { id: 'u2', email: 'friend.with.a.longer.name@example.com', created_at: t(60 * 24 * 6), last_sign_in_at: t(60 * 20), role: 'member', can_invite: true, invite_quota: 5, invited_by: 'owner@example.com', invites_used: 2, slates: 5, agents: 1, reminders_open: 2, push_devices: 1, last_seen: t(60 * 20) },
  { id: 'u3', email: 'new.person@example.com', created_at: t(60 * 3), last_sign_in_at: null, role: 'member', can_invite: false, invite_quota: 5, invited_by: 'friend.with.a.longer.name@example.com', invites_used: 0, slates: 0, agents: 0, reminders_open: 0, push_devices: 0, last_seen: null },
];

export const FIXTURE_NOTES = [
  { id: 'launch-plan', title: 'Launch plan', body: '## Goals\n- 100 sign-ups in week one\n- Record the **demo video** before Friday\n\n## Risks\n- Onboarding email lands in spam', tags: ['launchreel', 'work'], pinned: true, updated_at: t(42), by: 'Instinct' },
  { id: 'meeting-notes-acme', title: 'Meeting notes: Acme call', body: 'They want a pilot in December. Budget is approved; legal review takes two weeks.', tags: ['work'], updated_at: t(300), by: 'Claude' },
  { id: 'reading-list', title: 'Reading list', body: '- Designing Data-Intensive Applications\n- The Mom Test', tags: ['study'], updated_at: t(2000) },
  { id: 'gift-ideas', title: 'A note with a long title that wraps onto a second line on a narrow phone', body: '', updated_at: t(9000) },
];
export const FIXTURE_PROFILE = { name: 'Alex Lee', avatar: 'maker' as const, email: 'alex.lee@example.com' };
