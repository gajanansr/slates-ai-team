import Link from 'next/link';
import { BoardsSearch } from '@/components/boards-search';
import { NavBar } from '@/components/slate/nav-bar';
import { NewSlateButton } from '@/components/slate/new-slate';
import { PageTransition } from '@/components/page-transition';
import { groupBoards } from '@/lib/summary';
import { IllustrationPanel } from '@/components/illustrations';
import type { Slate } from '@/lib/kinds';

/** Every board, grouped by category, with a sticky chip filter. */
export function BoardsView({ all, filter, openNew, view = 'cards' }: { all: Slate[]; filter?: string; openNew?: boolean; view?: 'cards' | 'list' }) {
  const boards = all.filter((s) => !s.hidden && s.kind !== 'brief' && s.kind !== 'notes' && s.slug !== 'inbox' && s.slug !== 'desk');
  const groups = groupBoards(boards);
  const chip = (href: string, label: string, active: boolean, count?: number) => (
    <Link
      key={href}
      href={href}
      scroll={false}
      replace
      aria-current={active ? 'page' : undefined}
      className={`h-8 shrink-0 rounded-full px-3.5 text-[13px] leading-8 transition-colors active:scale-95 ${
        active ? 'bg-btn text-on-btn' : 'bg-surface text-fg-2 shadow-[var(--shadow-card)]'
      }`}
    >
      {label}
      {count !== undefined && <span className={active ? 'text-on-btn/60' : 'text-fg-4'}> {count}</span>}
    </Link>
  );

  return (
    <PageTransition>
      <NavBar title="Boards" actions={<NewSlateButton defaultOpen={openNew} />} backHref="/spaces" backLabel="Back to spaces">
        <header className="mb-4">
          <p className="kicker mb-2">
            {boards.length} boards · {groups.length} categories
          </p>
          <h1 className="text-[32px] font-medium leading-[1.1] tracking-[-0.045em] md:text-[36px]">All your boards.</h1>
        </header>
      </NavBar>

      <nav
        aria-label="Categories"
        className="no-scrollbar sticky top-[calc(63px+var(--safe-top))] z-20 -mx-4 mb-5 flex gap-1.5 overflow-x-auto bg-page px-4 pb-3 pt-1 sm:-mx-6 sm:px-6 md:top-0"
      >
        {chip('/boards', 'All', !filter)}
        {groups.map((g) => chip(`/boards?c=${g.slug}`, g.name, filter === g.slug, g.boards.length))}
      </nav>

      {boards.length === 0 ? (
        <div className="card p-4 text-center">
          <IllustrationPanel name="stack" className="mb-4 h-[150px]" />
          <p className="text-[17px] font-medium tracking-tight">No boards yet</p>
          <p className="mx-auto mt-1 max-w-[34ch] pb-2 text-sm text-fg-3">Ask an agent to create one, or tap + for a quick list.</p>
        </div>
      ) : (
        <BoardsSearch
          view={view}
          boards={filter ? (groups.find((g) => g.slug === filter)?.boards ?? []) : boards}
          category={filter ? groups.find((g) => g.slug === filter) : undefined}
        />
      )}
    </PageTransition>
  );
}
