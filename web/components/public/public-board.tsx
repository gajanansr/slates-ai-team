import { SlateBody } from '@/components/slate/slate-body';
import { ReadOnlyProvider } from '@/components/readonly';
import { BoardIcon } from '@/components/board-icon';
import type { Note, Slate } from '@/lib/kinds';

/** One board, read-only, for share links and the public demo. */
export function PublicBoard({ slate, notes }: { slate: Slate; notes?: Note[] }) {
  return (
    <ReadOnlyProvider>
      <section className="mb-6">
        <header className="mb-3 flex items-center gap-2.5 px-0.5">
          <span className="grid size-9 place-items-center rounded-xl bg-muted">
            <BoardIcon name={slate.icon} kind={slate.kind} className="size-[18px]" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-[20px] font-medium tracking-[-0.03em]">{slate.title}</h2>
            {slate.category && <p className="text-xs text-fg-3">{slate.category}</p>}
          </div>
        </header>
        {slate.kind === 'dashboard' ? (
          <SlateBody slate={slate} mode="full" notes={notes} />
        ) : (
          <div className="card p-4 sm:p-6">
            <SlateBody slate={slate} mode="full" notes={notes} />
          </div>
        )}
      </section>
    </ReadOnlyProvider>
  );
}

export const asSlate = (p: Partial<Slate> & Pick<Slate, 'slug' | 'title' | 'kind' | 'data'>): Slate => ({
  id: p.slug,
  icon: null,
  category: null,
  position: 0,
  pinned: false,
  hidden: false,
  archived_at: null,
  version: 1,
  created_by: null,
  updated_by: null,
  updated_by_name: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...p,
});
