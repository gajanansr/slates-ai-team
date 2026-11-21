'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { GripVertical } from 'lucide-react';

/**
 * Drag to reorder a list (mouse, pen and touch). Grab the handle, move up or down; the list
 * reorders live. Listeners sit on the window so the drag survives React moving the row.
 * The up/down buttons stay for keyboard and screen-reader use.
 */
export function useDragReorder(onMove: (from: number, to: number) => void) {
  const listRef = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const at = useRef<number | null>(null);
  const move = useRef(onMove);
  move.current = onMove;

  useEffect(() => {
    if (active === null) return;
    at.current = active;
    const onPoint = (e: PointerEvent) => {
      const rows = Array.from(listRef.current?.children ?? []) as HTMLElement[];
      if (!rows.length || at.current === null) return;
      let to = rows.findIndex((r) => e.clientY < r.getBoundingClientRect().bottom);
      if (to === -1) to = rows.length - 1;
      if (to !== at.current) {
        move.current(at.current, to);
        at.current = to;
        setActive(to);
      }
      // Near the screen edge: nudge the page so long lists stay reachable.
      if (e.clientY < 70) window.scrollBy(0, -12);
      else if (e.clientY > window.innerHeight - 70) window.scrollBy(0, 12);
    };
    const end = () => {
      at.current = null;
      setActive(null);
    };
    window.addEventListener('pointermove', onPoint);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', onPoint);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [active !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = useCallback((i: number) => (e: React.PointerEvent) => {
    if (e.button !== undefined && e.button > 0) return;
    e.preventDefault();
    setActive(i);
  }, []);
  return { listRef, active, start };
}

export function DragHandle({ label, onPointerDown, active }: { label: string; onPointerDown: (e: React.PointerEvent) => void; active: boolean }) {
  return (
    <button
      type="button"
      aria-label={`Drag to reorder ${label}`}
      onPointerDown={onPointerDown}
      style={{ touchAction: 'none' }}
      className={`grid size-9 flex-none cursor-grab place-items-center rounded-full text-fg-3 active:cursor-grabbing ${active ? 'bg-accent text-on-accent' : 'bg-muted'}`}
    >
      <GripVertical className="size-4" />
    </button>
  );
}
