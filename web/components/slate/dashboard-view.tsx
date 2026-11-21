import type { Note, Slate } from '@/lib/kinds';
import { Bento, metricBlocks, type Block } from '@/components/bento';

type Widget = { id: string; title: string; kind: string; width?: 'full' | 'half'; size?: 's' | 'm' | 'l' | 'xl'; view?: any; hidden?: boolean; section?: string; data: any; source?: string; as_of?: string; stale_after_hours?: number };

/** A dashboard board rendered as a bento grid. Card mode: compact preview (first metrics). */
export function DashboardView({ slate, data, mode, notes = [] }: { slate: Slate; data: { summary?: string; look?: 'cards' | 'compact' | 'focus'; widgets: Widget[] }; mode: 'card' | 'full'; notes?: Note[] }) {
  let featured = false;
  const blocks: Block[] = [];
  let lastSection: string | undefined;
  for (const w of data.widgets) {
    if (w.hidden) continue;
    if (mode === 'full' && w.section && w.section !== lastSection) blocks.push({ type: 'section', key: `sec-${w.id}`, title: w.section });
    lastSection = w.section;
    if (w.kind === 'metrics') {
      blocks.push(...metricBlocks(w.id, w.data.items ?? [], { group: w.title, featureFirst: !featured, source: w.source, as_of: w.as_of, stale_after_hours: w.stale_after_hours }));
      featured = true;
    } else {
      const wdata = w.kind === 'note' ? { ...w.data, resolved: notes.find((n) => n.id === w.data?.note) } : w.data;
      blocks.push({ type: 'widget', key: w.id, title: w.title, kind: w.kind, data: wdata, slate, widgetId: w.id, width: w.width, size: w.size, view: w.view, look: data.look, mode, source: w.source, as_of: w.as_of, stale_after_hours: w.stale_after_hours });
    }
  }
  if (mode === 'card') {
    return <Bento blocks={blocks.filter((b) => b.type === 'metric').slice(0, 3)} />;
  }
  return (
    <div>
      {data.summary && <p className="mb-4 text-[15px] leading-relaxed text-fg-2">{data.summary}</p>}
      <Bento blocks={blocks} look={data.look} />
    </div>
  );
}
