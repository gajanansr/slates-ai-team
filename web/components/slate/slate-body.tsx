import { ALL_KIND_SCHEMAS as KIND_SCHEMAS, type Note, type Slate } from '@/lib/kinds';
import { BriefView, LinksView, ListView, MarkdownView, MetricsView, TableView, TimelineView } from '@/components/slate/kinds';
import { Chart } from '@/components/charts/chart';
import { DashboardView } from '@/components/slate/dashboard-view';
import { HabitsView, TrackerView } from '@/components/slate/kinds-more';
import { CountdownWidget, GoalsWidget } from '@/components/slate/widget-visuals';

/**
 * Render a slate's data. Data is re-validated on read so one malformed write
 * can never crash the dashboard; it degrades to a notice instead.
 */
export function SlateBody({ slate, mode, notes }: { slate: Slate; mode: 'card' | 'full'; notes?: Note[] }) {
  const parsed = KIND_SCHEMAS[slate.kind]?.safeParse(slate.data);
  if (!parsed?.success) {
    return <p className="text-sm text-fg-3">This slate&apos;s data doesn&apos;t match its kind ({slate.kind}). Ask the agent that wrote it to fix it.</p>;
  }
  const props = { slate, mode, data: parsed.data as any };
  switch (slate.kind) {
    case 'brief':
      return <BriefView {...props} />;
    case 'list':
      return <ListView {...props} />;
    case 'links':
      return <LinksView {...props} />;
    case 'metrics':
      return <MetricsView {...props} />;
    case 'timeline':
      return <TimelineView {...props} />;
    case 'table':
      return <TableView {...props} />;
    case 'markdown':
      return <MarkdownView {...props} />;
    case 'chart':
      return <Chart data={parsed.data as any} mode={mode} />;
    case 'dashboard':
      return <DashboardView slate={slate} data={parsed.data as any} mode={mode} notes={notes} />;
    case 'tracker':
      return <TrackerView {...props} />;
    case 'habits':
      return <HabitsView {...props} />;
    case 'goals':
      return <GoalsWidget {...props} view={undefined} />;
    case 'countdown':
      return <CountdownWidget {...props} view={undefined} />;
    case 'notes':
      return <p className="text-sm text-fg-3">{(parsed.data as any).items.length} notes · open the Notes tab.</p>;
  }
}
