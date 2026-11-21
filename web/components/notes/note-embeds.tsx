import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { validateData, type Slate } from '@/lib/kinds';
import { embedBlocks } from '@/lib/note-media';
import { SlateBody } from '@/components/slate/slate-body';
import { DashboardView } from '@/components/slate/dashboard-view';
import { BoardIcon } from '@/components/board-icon';

const Problem = ({ children }: { children: React.ReactNode }) => <p className="my-3 rounded-2xl bg-muted px-3.5 py-3 text-[13.5px] text-fg-3">{children}</p>;

/** Render a note's live blocks (charts, boards, widgets) on the server; the reader slots them in. */
export function noteEmbeds(body: string, all: Slate[]): Record<string, React.ReactNode> {
  const out: Record<string, React.ReactNode> = {};
  for (const b of embedBlocks(body)) {
    if (b.lang === 'chart') {
      try {
        const data = validateData('chart', JSON.parse(b.code));
        out[b.key] = (
          <div className="note-embed my-4">
            <SlateBody slate={{ kind: 'chart', data, title: 'Chart', slug: 'note-chart' } as unknown as Slate} mode="full" />
          </div>
        );
      } catch (e) {
        out[b.key] = <Problem>This chart could not be drawn: {e instanceof Error ? e.message.slice(0, 160) : 'the data is not valid'}</Problem>;
      }
      continue;
    }
    const [slug, widgetId] = b.code.split('/').map((x) => x.trim());
    const slate = all.find((s) => s.slug === slug && !s.archived_at);
    if (!slate) {
      out[b.key] = <Problem>The board “{slug}” is not there any more.</Problem>;
      continue;
    }
    const widget = widgetId ? ((slate.data as any)?.widgets ?? []).find((w: any) => w.id === widgetId) : undefined;
    if (widgetId && (!widget || widget.kind === 'note')) {
      out[b.key] = <Problem>“{slate.title}” has no widget called “{widgetId}”.</Problem>;
      continue;
    }
    out[b.key] = (
      <div className="note-embed my-4">
        <Link href={`/s/${slate.slug}`} className="mb-2 flex items-center gap-2 text-[13px] text-fg-3 no-underline">
          <BoardIcon name={slate.icon} kind={slate.kind} className="size-3.5" />
          <span className="min-w-0 flex-1 truncate">{slate.title} · live</span>
          <ChevronRight className="size-3.5" />
        </Link>
        {widget ? <DashboardView slate={slate} data={{ widgets: [{ ...widget, hidden: false }] }} mode="full" /> : slate.kind === 'dashboard' ? <DashboardView slate={slate} data={{ ...(slate.data as any), widgets: ((slate.data as any).widgets ?? []).filter((w: any) => w.kind !== 'note') }} mode="full" /> : <SlateBody slate={slate} mode="card" />}
      </div>
    );
  }
  return out;
}
