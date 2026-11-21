import type { Slate } from '@/lib/kinds';
import { asSlate } from '@/components/public/public-board';

/** Public demo content. Entirely made up: no real person, account or figure. */
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export function demoBoards(): Slate[] {
  return [
    asSlate({
      slug: 'today',
      title: 'Today',
      kind: 'brief',
      icon: 'sun',
      data: {
        headline: 'Ship the landing page, then a quiet evening',
        items: [
          { id: 'a', text: 'Pay the electricity bill before 6pm', tone: 'bad' },
          { id: 'b', text: 'Review the onboarding copy draft', tone: 'warn' },
          { id: 'c', text: 'Gym, 7pm', done: true },
          { id: 'd', text: 'Reply to Sam about the weekend trip' },
        ],
      },
    }),
    asSlate({
      slug: 'launch',
      title: 'Side project launch',
      kind: 'dashboard',
      icon: 'rocket',
      category: 'Work',
      data: {
        summary: 'Kept current by an agent every morning',
        widgets: [
          { id: 'kpis', title: 'This week', kind: 'metrics', data: { items: [{ id: 'signups', label: 'Sign-ups', value: '128', trend: [12, 30, 41, 66, 90, 128] }, { id: 'visits', label: 'Visits', value: '3.4k', trend: [800, 1300, 1900, 2600, 3400] }, { id: 'paid', label: 'Paying', value: '9', tone: 'good' }] } },
          { id: 'chart', title: 'Daily sign-ups', kind: 'chart', data: { type: 'bar', labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], series: [{ id: 's', name: 'Sign-ups', values: [12, 18, 11, 25, 24, 22, 16] }], highlight: 3 } },
          { id: 'goal', title: 'Goal', kind: 'goals', width: 'half', data: { items: [{ id: 'g', title: 'First 250 users', current: 128, target: 250, deadline: day(40) }] } },
          { id: 'next', title: 'Next steps', kind: 'list', width: 'half', data: { items: [{ id: 'a', text: 'Record the demo video' }, { id: 'b', text: 'Post the launch thread', done: true }, { id: 'c', text: 'Email the waitlist' }] } },
        ],
      },
    }),
    asSlate({
      slug: 'jobs',
      title: 'Job hunt',
      kind: 'tracker',
      icon: 'briefcase',
      data: {
        stages: [{ id: 'applied', name: 'Applied' }, { id: 'interview', name: 'Interview' }, { id: 'offer', name: 'Offer' }],
        items: [
          { id: 'a', title: 'Northwind · Product designer', stage: 'interview', due: day(3) },
          { id: 'b', title: 'Globex · Design lead', stage: 'applied' },
          { id: 'c', title: 'Initech · UX writer', stage: 'applied' },
          { id: 'd', title: 'Umbrella · Designer', stage: 'offer' },
        ],
      },
    }),
    asSlate({
      slug: 'habits',
      title: 'Habits',
      kind: 'habits',
      icon: 'activity',
      data: { items: [{ id: 'run', name: 'Run 5k', days: [-1, -2, -3, -5, -6, -8, -9, -10].map(day) }, { id: 'read', name: 'Read 20 pages', days: [0, -1, -2, -3, -4].map(day) }] },
    }),
    asSlate({
      slug: 'trips',
      title: 'Countdowns',
      kind: 'countdown',
      icon: 'plane',
      data: { items: [{ id: 'goa', title: 'Goa trip', date: day(12) }, { id: 'bday', title: "Mum's birthday", date: day(4) }, { id: 'tax', title: 'Tax filing', date: day(27) }] },
    }),
  ];
}
