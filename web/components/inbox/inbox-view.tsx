'use client';
import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ImagePlus, Inbox as InboxIcon, Loader2, Sparkles, X } from 'lucide-react';
import type { ListData } from '@/lib/kinds';
import { captureToInbox, dismissInbox, fileInbox } from '@/app/(app)/feature-actions';
import { Attachments } from '@/components/slate/attachments';
import { Select } from '@/components/ui/select';

type Item = ListData['items'][number];

/** The Inbox: capture now, sort later. Each item can be filed to a board, into Notes, or dismissed. */
export function InboxView({ items, boards, canAsk, flash, initialText = '' }: { items: Item[]; boards: { slug: string; title: string; kind: string }[]; canAsk: boolean; flash?: string; initialText?: string }) {
  const [text, setText] = useState(initialText);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const add = () =>
    start(async () => {
      setError('');
      const fd = new FormData();
      fd.set('text', text);
      for (const f of files) fd.append('file', f);
      const r = await captureToInbox(fd);
      if (!r.ok) return setError(r.error);
      setText('');
      setFiles([]);
    });

  return (
    <div className="space-y-4">
      {flash === '1' && <p className="rounded-2xl bg-sage px-4 py-3 text-sm">Saved to your Inbox.</p>}
      {flash === '0' && <p className="rounded-2xl bg-muted px-4 py-3 text-sm">That share couldn&apos;t be saved. Try adding it here.</p>}
      <form
        className="card p-3"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Jot a thought, paste a link…"
          aria-label="Capture to Inbox"
          className="w-full resize-none bg-transparent px-1 py-1 text-[16px] outline-none placeholder:text-fg-4"
        />
        {files.length > 0 && (
          <p className="mb-2 flex flex-wrap gap-1.5">
            {files.map((f, i) => (
              <span key={i} className="pill gap-1">
                {f.name.slice(0, 24)}
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </p>
        )}
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => fileRef.current?.click()} className="btn btn-glass h-10 px-3 text-[13px]">
            <ImagePlus className="size-4" strokeWidth={1.7} /> Photo or PDF
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/heic,application/pdf"
            multiple
            hidden
            onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])].slice(0, 10))}
          />
          <button className="btn btn-primary h-10 px-4" disabled={pending || (!text.trim() && !files.length)}>
            {pending && <Loader2 className="size-4 animate-spin" />} Capture
          </button>
        </div>
        {error && <p className="pt-2 text-sm">{error}</p>}
      </form>

      {items.length > 0 && canAsk && (
        <Link href="/ask?q=File%20my%20inbox" className="btn btn-accent w-full">
          <Sparkles className="size-4" strokeWidth={1.8} /> Ask Slates to file everything
        </Link>
      )}

      {items.length === 0 ? (
        <div className="card p-6 text-center">
          <InboxIcon className="mx-auto mb-2 size-6 text-fg-3" strokeWidth={1.5} />
          <p className="text-[15px] font-medium">Inbox zero</p>
          <p className="mx-auto mt-1 max-w-[40ch] text-sm text-fg-3">Share links, text or screenshots to Slates from any app, or jot them above. Sort them later, or let Ask Slates do it.</p>
        </div>
      ) : (
        <ul className="card divide-y divide-line">
          {items.map((it) => (
            <InboxRow key={it.id} it={it} boards={boards} />
          ))}
        </ul>
      )}
    </div>
  );
}

function InboxRow({ it, boards }: { it: Item; boards: { slug: string; title: string; kind: string }[] }) {
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const targets = boards.filter((b) => ['list', 'brief', 'tracker'].includes(b.kind) || (b.kind === 'links' && it.href));
  const go = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? 'Failed');
    });
  return (
    <li className="p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-snug [overflow-wrap:anywhere]">{it.text}</p>
          {it.detail && <p className="mt-1 line-clamp-3 text-[13px] text-fg-3">{it.detail}</p>}
          <p className="mt-1 text-[12px] text-fg-4">{it.meta}</p>
        </div>
        {it.href && (
          <a href={it.href} target="_blank" rel="noopener noreferrer" aria-label="Open link" className="grid size-9 flex-none place-items-center rounded-full text-fg-3 active:bg-muted">
            <ArrowUpRight className="size-4" strokeWidth={1.75} />
          </a>
        )}
      </div>
      {it.files && it.files.length > 0 && <Attachments files={it.files} title="Attached" />}
      <div className="mt-3 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Select size="sm" label="File to" placeholder="File to…" value={to} onChange={setTo} options={[{ value: '__note', label: 'Notes' }, ...targets.map((b) => ({ value: b.slug, label: b.title }))]} />
        </div>
        <button type="button" className="btn btn-primary h-10 px-3.5 text-[13px]" disabled={!to || pending} onClick={() => go(() => fileInbox(it.id, to === '__note' ? { note: true } : { slug: to }))}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : 'File'}
        </button>
        <button type="button" className="btn btn-glass btn-icon h-10" aria-label="Dismiss" disabled={pending} onClick={() => go(() => dismissInbox(it.id))}>
          <X className="size-4" />
        </button>
      </div>
      {error && <p className="pt-2 text-sm">{error}</p>}
    </li>
  );
}
