'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, FileDown, Printer, Share } from 'lucide-react';
import type { Note } from '@/lib/kinds';
import { noteMarkdown } from '@/lib/note-media';

/** Take a note out of Slates: copy it, download it as Markdown, or print it / save it as a PDF. */
export function NoteExport({ note }: { note: Note }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const md = () => noteMarkdown(note);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(md());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the download still works */
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([md()], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${note.id}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setOpen(false);
  };
  const row = 'flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[14.5px] active:bg-muted';
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} aria-label="Export note" title="Export" className="grid size-9 place-items-center rounded-full text-fg-3 transition hover:bg-muted hover:text-fg active:scale-95">
        <Share className="size-[18px]" strokeWidth={1.75} />
      </button>
      {open && (
        <div role="menu" className="glass-strong absolute right-0 top-10 z-20 w-56 rounded-2xl p-1.5 shadow-[var(--shadow-float)]">
          <button type="button" role="menuitem" onClick={copy} className={row}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4 text-fg-3" strokeWidth={1.7} />} {copied ? 'Copied' : 'Copy as text'}
          </button>
          <button type="button" role="menuitem" onClick={download} className={row}>
            <FileDown className="size-4 text-fg-3" strokeWidth={1.7} /> Download Markdown
          </button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); setTimeout(() => window.print(), 50); }} className={row}>
            <Printer className="size-4 text-fg-3" strokeWidth={1.7} /> Print or save as PDF
          </button>
        </div>
      )}
    </div>
  );
}
