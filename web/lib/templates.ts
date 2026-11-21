import type { SlateKind } from '@/lib/kinds';
import type { IconName } from '@/lib/icons';

/** One-tap starter boards. Each comes with a prompt to hand an agent to keep it filled. */
export type Template = {
  id: string;
  title: string;
  blurb: string;
  kind: SlateKind;
  icon: IconName;
  category?: string;
  data: Record<string, unknown>;
  prompt: string;
};

const d = (offset: number) => {
  const t = new Date(Date.now() + offset * 86_400_000);
  return t.toISOString().slice(0, 10);
};

export const TEMPLATES: Template[] = [
  {
    id: 'budget',
    title: 'Monthly budget',
    blurb: 'Income, spend and what is left, with a chart.',
    kind: 'dashboard',
    icon: 'wallet',
    category: 'Money',
    data: {
      summary: 'Where the money goes this month',
      widgets: [
        { id: 'kpis', title: 'This month', kind: 'metrics', data: { items: [{ id: 'in', label: 'Income', value: '₹0' }, { id: 'out', label: 'Spent', value: '₹0' }, { id: 'left', label: 'Left', value: '₹0' }] } },
        { id: 'spend', title: 'Spend by week', kind: 'chart', data: { type: 'bar', labels: ['W1', 'W2', 'W3', 'W4'], series: [{ id: 's', name: 'Spend', values: [0, 0, 0, 0] }], prefix: '₹' } },
        { id: 'bills', title: 'Bills due', kind: 'list', data: { items: [{ id: 'rent', text: 'Rent', meta: '1st' }] } },
      ],
    },
    prompt: 'Keep my "Monthly budget" board in Slates up to date: update income, spent and left in the kpis widget, the weekly spend chart, and the bills due list whenever I tell you about money.',
  },
  {
    id: 'trip',
    title: 'Trip planner',
    blurb: 'Countdown, packing list and bookings.',
    kind: 'dashboard',
    icon: 'plane',
    category: 'Travel',
    data: {
      summary: 'Everything for the next trip',
      widgets: [
        { id: 'when', title: 'Countdown', kind: 'countdown', width: 'half', data: { items: [{ id: 'trip', title: 'Trip starts', date: d(30) }] } },
        { id: 'pack', title: 'Packing', kind: 'list', width: 'half', data: { items: [{ id: 'passport', text: 'Passport' }, { id: 'charger', text: 'Chargers' }] } },
        { id: 'book', title: 'Bookings', kind: 'table', data: { columns: [{ key: 'what', label: 'What' }, { key: 'when', label: 'When' }, { key: 'ref', label: 'Ref' }], rows: [] } },
      ],
    },
    prompt: 'Help me plan my trip on my "Trip planner" board in Slates: set the countdown date, add bookings to the table as I confirm them, and keep the packing list.',
  },
  {
    id: 'job-hunt',
    title: 'Job hunt',
    blurb: 'Applications moving from applied to offer.',
    kind: 'tracker',
    icon: 'briefcase',
    category: 'Work',
    data: {
      stages: [
        { id: 'saved', name: 'Saved' },
        { id: 'applied', name: 'Applied' },
        { id: 'interview', name: 'Interview' },
        { id: 'offer', name: 'Offer' },
      ],
      items: [{ id: 'example', title: 'Example Co · Role', stage: 'saved' }],
    },
    prompt: 'Track my job applications on my "Job hunt" tracker in Slates. Add each role as an item, move it between stages (saved, applied, interview, offer) as things happen, and set due dates for follow-ups.',
  },
  {
    id: 'reading',
    title: 'Reading list',
    blurb: 'Books and articles to get through.',
    kind: 'list',
    icon: 'book',
    category: 'Personal',
    data: { items: [] },
    prompt: 'When I mention a book or article I want to read, add it to my "Reading list" board in Slates with the author in meta and a link if there is one.',
  },
  {
    id: 'habits',
    title: 'Habits',
    blurb: 'Daily check-offs with streaks.',
    kind: 'habits',
    icon: 'activity',
    category: 'Health',
    data: { items: [{ id: 'move', name: 'Move 30 minutes', days: [] }, { id: 'read', name: 'Read 20 pages', days: [] }, { id: 'water', name: '8 glasses of water', days: [] }] },
    prompt: 'When I tell you I did one of my habits, tick today on my "Habits" board in Slates (add today\'s YYYY-MM-DD to that habit\'s days).',
  },
  {
    id: 'goals',
    title: 'Goals',
    blurb: 'Targets with progress and deadlines.',
    kind: 'goals',
    icon: 'target',
    category: 'Personal',
    data: { items: [{ id: 'fund', title: 'Emergency fund', current: 0, target: 100000, prefix: '₹', deadline: d(180) }] },
    prompt: 'Keep my "Goals" board in Slates current: update each goal\'s current value when I report progress, and add new goals with a target and deadline.',
  },
  {
    id: 'countdowns',
    title: 'Countdowns',
    blurb: 'Trips, launches, birthdays, due dates.',
    kind: 'countdown',
    icon: 'calendar',
    data: { items: [{ id: 'new-year', title: 'New year', date: `${new Date().getFullYear() + 1}-01-01` }] },
    prompt: 'Add important dates I mention (trips, launches, birthdays, due dates) to my "Countdowns" board in Slates.',
  },
  {
    id: 'launch',
    title: 'Launch dashboard',
    blurb: 'Sign-ups, next steps and the plan.',
    kind: 'dashboard',
    icon: 'rocket',
    category: 'Work',
    data: {
      summary: 'Launch progress at a glance',
      widgets: [
        { id: 'kpis', title: 'This week', kind: 'metrics', data: { items: [{ id: 'signups', label: 'Sign-ups', value: '0' }, { id: 'visits', label: 'Visits', value: '0' }] } },
        { id: 'next', title: 'Next steps', kind: 'list', data: { items: [{ id: 'a', text: 'Write the launch post' }] } },
        { id: 'goal', title: 'Goal', kind: 'goals', data: { items: [{ id: 'users', title: 'First 100 users', current: 0, target: 100 }] } },
      ],
    },
    prompt: 'Run my "Launch dashboard" in Slates: refresh the sign-ups and visits tiles daily, keep the next steps list current, update the First 100 users goal, and put any plans or write-ups in Notes linked from the dashboard.',
  },
];
