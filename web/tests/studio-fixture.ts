/**
 * A model reply for "manage my dairy business", shaped like real output (used when no AI key is
 * available locally). Example rows are marked "(example)"; nothing personal.
 */
export const DAIRY_REPLY = {
  name: 'Dairy Manager',
  icon: 'leaf',
  color: 'green',
  mission: 'Keeps your milk collection, deliveries, customer dues, feed stock and herd health in one place, every day.',
  space: 'Dairy Manager',
  boards: [
    {
      title: 'Today at the dairy',
      kind: 'dashboard',
      icon: 'chart-bar',
      purpose: 'The day at a glance: milk in, milk out, money due.',
      data: {
        summary: 'Collection, deliveries and dues for today',
        widgets: [
          {
            id: 'kpis',
            title: 'Today',
            kind: 'metrics',
            size: 'xl',
            data: {
              items: [
                { id: 'milk-today', label: 'Milk today (L)', value: '0', sub: 'Morning + evening collection' },
                { id: 'delivered', label: 'Delivered (L)', value: '0', sub: 'Across all routes' },
                { id: 'payments-due', label: 'Payments due', value: '₹0', sub: 'Unpaid customer dues', tone: 'warn' },
                { id: 'feed-days', label: 'Feed left', value: '—', sub: 'Days of feed at current use' },
              ],
            },
          },
          {
            id: 'collection',
            title: 'Collection log',
            kind: 'table',
            size: 'l',
            data: {
              columns: [
                { key: 'session', label: 'Session' },
                { key: 'litres', label: 'Litres', align: 'end' },
                { key: 'fat', label: 'Fat %', align: 'end' },
              ],
              rows: [
                { id: 'am', cells: { session: 'Morning (example)', litres: '0', fat: '—' } },
                { id: 'pm', cells: { session: 'Evening (example)', litres: '0', fat: '—' } },
              ],
            },
          },
          {
            id: 'today-tasks',
            title: 'Today',
            kind: 'list',
            size: 'm',
            data: { items: [{ id: 'log-am', text: 'Log morning collection' }, { id: 'routes', text: 'Send out delivery routes' }] },
          },
        ],
      },
    },
    {
      title: 'Customers',
      kind: 'table',
      icon: 'people',
      purpose: 'Who gets how much each day, and what they owe.',
      data: {
        columns: [
          { key: 'customer', label: 'Customer' },
          { key: 'route', label: 'Route' },
          { key: 'litres', label: 'L/day', align: 'end' },
          { key: 'due', label: 'Due', align: 'end' },
        ],
        rows: [
          { id: 'cust-a', cells: { customer: 'Customer A (example)', route: 'Route 1', litres: 2, due: '₹0' } },
          { id: 'cust-b', cells: { customer: 'Customer B (example)', route: 'Route 2', litres: '1.5', due: '₹0' } },
        ],
      },
    },
    {
      title: 'Cattle health',
      kind: 'tracker',
      icon: 'health',
      purpose: 'Each animal from check-up to treated, with vet visits due.',
      data: {
        stages: [
          { id: 'healthy', name: 'Healthy' },
          { id: 'watch', name: 'Watch' },
          { id: 'vet', name: 'Vet visit' },
        ],
        items: [
          { id: 'cow-1', title: 'Cow 1 (example): deworming due', stage: 'watch', due: '2026-12-01' },
          { id: 'cow-2', title: 'Cow 2 (example): limping', stage: 'Sick' },
        ],
      },
    },
    {
      title: 'Feed stock',
      kind: 'table',
      icon: 'package',
      purpose: 'What is in the store and when to reorder.',
      data: {
        columns: [
          { key: 'feed', label: 'Feed' },
          { key: 'stock', label: 'In stock', align: 'end' },
          { key: 'reorder', label: 'Reorder at', align: 'end' },
        ],
        rows: [{ id: 'cattle-feed', cells: { feed: 'Cattle feed (example)', stock: '0 bags', reorder: '5 bags' } }],
      },
    },
    { title: 'Daily routine', kind: 'list', icon: 'checklist', data: { items: [{ id: 'clean', text: 'Clean the shed and water troughs' }, { id: 'milk', text: 'Milking, 5:30 and 17:30' }] } },
  ],
  routines: [
    { title: 'Morning collection check', schedule: { every: 'daily', at_hour: 8 }, does: 'Add up the morning collection on the dashboard and flag any drop of more than 10% against the last week.' },
    { title: 'Dues follow-up', schedule: { every: 'weekly', at_hour: 10, at_weekday: 1 }, does: 'List customers with dues older than a month and draft a polite reminder for each.' },
    { title: 'Feed stock check', schedule: { every: 'weekly', at_hour: 18, at_weekday: 5 }, does: 'Compare feed stock with the reorder level and add a reorder task when it is low.' },
  ],
  reminders: [
    { text: 'Log the evening milk collection', time: '18:30', repeat: 'daily' },
    { text: 'Collect monthly payments', time: '10:00', repeat: 'monthly' },
  ],
  notes: [
    { title: 'Getting started with Dairy Manager', body: '## First week\n- [ ] Replace the example customers with yours\n- [ ] Add each animal to Cattle health\n- [ ] Count your feed stock' },
  ],
  questions: ['How many animals do you milk, and how many delivery routes do you run?', 'Do customers pay daily, weekly or monthly?', 'Which vet do you use, and how often do they visit?'],
};
