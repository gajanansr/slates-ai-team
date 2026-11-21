import Link from 'next/link';
import { ChevronRight, LayoutGrid, NotebookPen } from 'lucide-react';
import { supabaseServer } from '@/lib/supabase/server';
import { slates as svc } from '@/lib/slates';
import { getBoard, notesOf } from '@/lib/notes';
import { spacesOf } from '@/lib/spaces';
import { summarize } from '@/lib/summary';
import { NavBar } from '@/components/slate/nav-bar';
import { NewSlateButton } from '@/components/slate/new-slate';
import { PageTransition } from '@/components/page-transition';
import { BoardIcon } from '@/components/board-icon';
import { IllustrationPanel } from '@/components/illustrations';

export const metadata = { title: 'Spaces' };

/** Every area of your life, each holding its boards and notes together. */
export default async function SpacesPage() {
  const caller = { client: await supabaseServer(), token: null };
  const [all, board] = await Promise.all([svc.list(caller), getBoard(caller).catch(() => null)]);
  const notes = notesOf(board);
  const spaces = spacesOf(all, notes);
  return (
    <PageTransition>
      <NavBar title="Spaces" actions={<NewSlateButton />} backHref={null}>
        <header className="mb-5">
          <h1 className="text-[30px] font-medium leading-[1.1] tracking-[-0.045em] md:text-[36px]">Spaces</h1>
        </header>
      </NavBar>

      {spaces.length === 0 ? (
        <div className="card p-4 text-center">
          <IllustrationPanel name="stack" className="mb-4 h-[150px]" />
          <p className="text-[17px] font-medium tracking-tight">No spaces yet</p>
          <p className="mx-auto mt-1 max-w-[36ch] pb-2 text-sm text-fg-3">Tell an agent what you want to keep track of, like money, work or health, and it sets the space up for you.</p>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {spaces.map((sp) => (
            <li key={sp.slug}>
              <Link href={`/spaces/${sp.slug}`} transitionTypes={['nav-forward']} className="card press block p-4">
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h2 className="min-w-0 truncate text-[21px] font-medium tracking-[-0.035em]">{sp.name}</h2>
                  <span className="flex-none text-[12.5px] text-fg-3">
                    {sp.boards.length} board{sp.boards.length === 1 ? '' : 's'}
                    {sp.notes.length > 0 && ` · ${sp.notes.length} note${sp.notes.length === 1 ? '' : 's'}`}
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {sp.boards.slice(0, 3).map((b) => {
                    const { stat, label } = summarize(b);
                    return (
                      <li key={b.slug} className="flex items-center gap-2.5 text-[14px]">
                        <BoardIcon name={b.icon} kind={b.kind} className="size-3.5 flex-none text-fg-3" />
                        <span className="min-w-0 flex-1 truncate text-fg-2">{b.title}</span>
                        <span className="max-w-[45%] flex-none truncate font-medium">{stat || label.split(' · ')[0]}</span>
                      </li>
                    );
                  })}
                  {sp.boards.length > 3 && <li className="text-[12.5px] text-fg-4">+{sp.boards.length - 3} more</li>}
                </ul>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <ul className="card mt-4 divide-y divide-line">
        <li>
          <Link href="/boards" transitionTypes={['nav-forward']} className="flex items-center gap-3 px-4 py-3.5">
            <LayoutGrid className="size-[18px] flex-none text-fg-3" strokeWidth={1.6} />
            <span className="min-w-0 flex-1 text-[15px]">All boards</span>
            <span className="text-[13px] text-fg-3">{spaces.reduce((n, sp) => n + sp.boards.length, 0)}</span>
            <ChevronRight className="size-4 text-fg-4" />
          </Link>
        </li>
        <li>
          <Link href="/notes" transitionTypes={['nav-forward']} className="flex items-center gap-3 px-4 py-3.5">
            <NotebookPen className="size-[18px] flex-none text-fg-3" strokeWidth={1.6} />
            <span className="min-w-0 flex-1 text-[15px]">All notes</span>
            <span className="text-[13px] text-fg-3">{notes.length}</span>
            <ChevronRight className="size-4 text-fg-4" />
          </Link>
        </li>
      </ul>
    </PageTransition>
  );
}
