'use client';
import { useRef, useState, useTransition } from 'react';
import { Loader2, Maximize2 } from 'lucide-react';
import { newNote, quickNote } from '@/app/(app)/note-actions';

/** "Take a note…": a bar that opens into title + text, saves in place (like Keep). */
export function QuickNote() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const box = useRef<HTMLFormElement>(null);

  const save = () =>
    start(async () => {
      if (!title.trim() && !body.trim()) return setOpen(false);
      const r = await quickNote(title, body);
      if (!r.ok) return setError(r.error);
      setTitle('');
      setBody('');
      setError('');
      setOpen(false);
    });

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="card mb-4 flex h-[52px] w-full items-center px-4 text-left text-[15.5px] text-fg-3 active:scale-[0.995]">
        Take a note…
      </button>
    );

  return (
    <form
      ref={box}
      className="card mb-4 p-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      onBlur={(e) => {
        // Clicking away saves, like Keep.
        if (!box.current?.contains(e.relatedTarget as Node)) save();
      }}
    >
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" maxLength={120} aria-label="Title" className="h-11 w-full bg-transparent px-2.5 text-[16px] font-medium outline-none placeholder:text-fg-4" />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Take a note…  (- [ ] makes a checklist)"
        aria-label="Note"
        rows={3}
        className="block max-h-[40dvh] min-h-20 w-full resize-none bg-transparent px-2.5 py-1 text-[15.5px] leading-relaxed outline-none [field-sizing:content] placeholder:text-fg-4"
      />
      {error && <p className="px-2.5 pb-1 text-sm">{error}</p>}
      <div className="flex items-center justify-between gap-2 px-1 pb-0.5 pt-1">
        <button type="button" onClick={() => start(async () => void (await newNote(title || 'Untitled')))} className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] text-fg-3 active:bg-muted" aria-label="Open the full editor">
          <Maximize2 className="size-3.5" strokeWidth={1.8} /> Full editor
        </button>
        <button className="btn btn-primary h-9 px-4 text-[13.5px]" disabled={pending}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : 'Save'}
        </button>
      </div>
    </form>
  );
}
