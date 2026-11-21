'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, FileText, Inbox, LayoutGrid, ListChecks, Loader2, NotebookPen, Plus, Search, Sparkles, AlarmClock } from 'lucide-react';
import { searchEverything } from '@/app/(app)/feature-actions';
import type { Hit } from '@/lib/search';

export const openCommand = () => window.dispatchEvent(new Event('slates:command'));

const ICON = { board: LayoutGrid, item: ListChecks, note: NotebookPen, reminder: AlarmClock } as const;

/** Search everything + quick actions. Cmd/Ctrl-K anywhere, or the search button on Home. */
export function CommandPalette({ canAsk }: { canAsk: boolean }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [pending, start] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('slates:command', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('slates:command', onOpen);
    };
  }, []);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
    if (!open) {
      setQ('');
      setHits([]);
    }
  }, [open]);

  useEffect(() => {
    if (!q.trim()) return setHits([]);
    const t = setTimeout(() => start(async () => setHits(await searchEverything(q))), 180);
    return () => clearTimeout(t);
  }, [q]);

  const enc = encodeURIComponent(q.trim());
  const actions = [
    ...(q.trim() && canAsk ? [{ label: `Ask Slates: “${q.trim()}”`, icon: Sparkles, href: `/ask?q=${enc}` }] : []),
    ...(q.trim() ? [{ label: `Capture “${q.trim().slice(0, 40)}” to Inbox`, icon: Inbox, href: `/inbox?text=${enc}` }] : []),
    ...(!q.trim()
      ? [
          ...(canAsk ? [{ label: 'Ask Slates', icon: Sparkles, href: '/ask' }] : []),
          { label: 'Inbox', icon: Inbox, href: '/inbox' },
          { label: 'New board from a template', icon: Plus, href: '/boards/new' },
          { label: 'New note', icon: FileText, href: '/notes' },
          { label: 'Agenda: this week', icon: CalendarDays, href: '/reminders' },
        ]
      : []),
  ];
  const hitRows = hits.map((h) => ({ label: h.title, sub: `${h.kind === 'item' ? 'In ' : ''}${h.sub}`, icon: ICON[h.kind], href: h.href }));
  const actionRows = actions.map((a) => ({ ...a, sub: '' }));
  // With AI on, Enter asks; search results sit right under it.
  const rows = q.trim() && canAsk ? [actionRows[0], ...hitRows, ...actionRows.slice(1)] : [...hitRows, ...actionRows];
  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <dialog
      ref={ref}
      onClose={() => setOpen(false)}
      onClick={(e) => e.target === ref.current && setOpen(false)}
      aria-label="Search"
      className="m-0 mx-auto mt-[max(12px,var(--safe-top))] w-[calc(100%-24px)] max-w-xl bg-transparent p-0 text-fg backdrop:bg-page/50 backdrop:backdrop-blur-sm sm:mt-[12vh]"
    >
      <div className="glass-strong overflow-hidden rounded-[24px]">
        <div className="flex items-center gap-2 border-b border-line px-4">
          {pending ? <Loader2 className="size-[18px] animate-spin text-fg-3" /> : canAsk ? <Sparkles className="size-[18px] text-fg-3" strokeWidth={1.8} /> : <Search className="size-[18px] text-fg-3" strokeWidth={1.8} />}
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, rows.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter' && rows[active]) {
                e.preventDefault();
                go(rows[active].href);
              }
            }}
            placeholder={canAsk ? 'Ask Slates or search…' : 'Search boards, items, notes…'}
            aria-label={canAsk ? 'Ask Slates or search' : 'Search'}
            enterKeyHint={canAsk ? 'send' : 'go'}
            className="h-14 flex-1 bg-transparent text-[16px] outline-none placeholder:text-fg-4"
          />
          <kbd className="hidden rounded-md border border-line px-1.5 text-[11px] text-fg-4 sm:block">esc</kbd>
        </div>
        <ul className="max-h-[60dvh] overflow-y-auto overscroll-contain p-1.5" role="listbox">
          {rows.map((r, i) => {
            const I = r.icon;
            return (
              <li key={`${r.href}|${r.label}|${i}`} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(r.href)}
                  className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left ${i === active ? 'bg-muted' : ''}`}
                >
                  <I className="size-[18px] flex-none text-fg-3" strokeWidth={1.7} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px]">{r.label}</span>
                    {r.sub && <span className="block truncate text-[12.5px] text-fg-3">{r.sub}</span>}
                  </span>
                </button>
              </li>
            );
          })}
          {q.trim() && !pending && hits.length === 0 && <li className="px-3 py-2 text-sm text-fg-3">No matches in your boards or notes.</li>}
        </ul>
      </div>
    </dialog>
  );
}
