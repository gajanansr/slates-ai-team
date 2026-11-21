'use client';
import { useRef, useState, useTransition } from 'react';
import { CornerDownLeft, Loader2 } from 'lucide-react';
import { addListItem } from '@/app/(app)/actions';

export function QuickAdd({ slug }: { slug: string }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  return (
    <form
      className="mt-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await addListItem(slug, text);
          if (r.ok) {
            setText('');
            setError('');
            input.current?.focus();
          } else setError(r.error);
        });
      }}
    >
      <div className="relative">
        <input
          ref={input}
          className="field pr-12"
          placeholder="Add an item"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          enterKeyHint="done"
        />
        <button
          className="absolute right-1.5 top-1.5 grid size-9 place-items-center rounded-[10px] text-fg-3 transition-colors hover:text-fg disabled:opacity-40"
          disabled={pending || !text.trim()}
          aria-label="Add"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <CornerDownLeft className="size-4" />}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-fg">{error}</p>}
    </form>
  );
}
