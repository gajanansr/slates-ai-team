'use client';
import { useEffect, useState, useTransition } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import { Check, Mic, X } from 'lucide-react';
import { remarkGfmSafe } from '@/lib/markdown';
import { ATT, embedKey, fixClipLength, isAudioPath, toggleTaskAt } from '@/lib/note-media';
import { saveNote } from '@/app/(app)/note-actions';

/**
 * A note, laid out for reading: book-like type, images inline (tap for full screen), and
 * checklists you can tick without opening the editor.
 */
export function NoteBody({ id, body, urls, embeds = {} }: { id: string; body: string; urls: Record<string, string>; embeds?: Record<string, React.ReactNode> }) {
  const [text, setText] = useState(body);
  const [zoom, setZoom] = useState<string | null>(null);
  const [, start] = useTransition();
  useEffect(() => setText(body), [body]);
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setZoom(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoom]);

  if (!text.trim()) return <p className="text-[15px] text-fg-3">Empty note. Ask an agent to write it, or tap the pencil.</p>;

  const toggle = (offset: number) => {
    const next = toggleTaskAt(text, offset);
    if (next === null) return;
    setText(next);
    navigator.vibrate?.(8);
    start(async () => {
      const r = await saveNote(id, { body: next });
      if (!r.ok) setText(text);
    });
  };

  return (
    <>
      <div className="prose-slate prose-note">
        <Markdown
          remarkPlugins={[remarkGfmSafe]}
          urlTransform={(url) => (url.startsWith(ATT) ? url : defaultUrlTransform(url))}
          components={{
            a: ({ node: _n, ...p }) => <a {...p} target="_blank" rel="noopener noreferrer" />,
            input: () => null,
            // ```chart and ```board blocks were drawn on the server; anything else stays a code block.
            pre: ({ node, children, ...p }) => {
              const code = (node?.children ?? []).find((c: any) => c.type === 'element' && c.tagName === 'code') as any;
              const lang = (([] as string[]).concat(code?.properties?.className ?? []).find((c) => String(c).startsWith('language-')) ?? '').replace('language-', '');
              const text = (code?.children ?? []).map((c: any) => c.value ?? '').join('');
              const hit = lang ? embeds[embedKey(lang, text)] : undefined;
              return hit ? <>{hit}</> : <pre {...p}>{children}</pre>;
            },
            li: ({ node, className, children, ...p }) => {
              if (!String(className ?? '').includes('task-list-item')) return <li className={className} {...p}>{children}</li>;
              const box = (node?.children ?? []).find((c: any) => c.type === 'element' && c.tagName === 'input') as any;
              const checked = Boolean(box?.properties?.checked);
              const offset = node?.position?.start.offset;
              return (
                <li className={`task-item ${checked ? 'is-done' : ''}`} {...p}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    aria-label={checked ? 'Mark not done' : 'Mark done'}
                    onClick={() => offset !== undefined && toggle(offset)}
                    className={`task-box ${checked ? 'bg-accent text-on-accent border-transparent' : 'border-fg-4'}`}
                  >
                    {checked && <Check className="size-3.5" strokeWidth={3} />}
                  </button>
                  <div className="min-w-0 flex-1">{children}</div>
                </li>
              );
            },
            img: ({ node: _n, src, alt }) => {
              const s = typeof src === 'string' ? (src.startsWith(ATT) ? urls[src.slice(ATT.length)] : src) : undefined;
              if (typeof src === 'string' && src.startsWith(ATT) && isAudioPath(src)) {
                return s ? (
                  <span className="note-voice my-2 flex items-center gap-3 rounded-2xl bg-muted p-2.5">
                    <span className="grid size-9 flex-none place-items-center rounded-full bg-accent text-on-accent"><Mic className="size-4" strokeWidth={2} /></span>
                    <audio controls preload="metadata" src={s} onLoadedMetadata={(e) => fixClipLength(e.currentTarget)} className="h-9 min-w-0 flex-1" aria-label={alt || 'Voice note'} />
                  </span>
                ) : (
                  <span className="block h-14 w-full animate-pulse rounded-2xl bg-muted" aria-label="Voice note" />
                );
              }
              if (!s) return <span className="block aspect-[4/3] w-full animate-pulse rounded-2xl bg-muted" aria-label={alt || 'Image'} />;
              return (
                <button type="button" onClick={() => setZoom(s)} className="note-img block w-full overflow-hidden rounded-2xl border border-line" aria-label={alt ? `Open image: ${alt}` : 'Open image'}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s} alt={alt ?? ''} loading="lazy" decoding="async" className="block h-auto w-full" />
                </button>
              );
            },
          }}
        >
          {text}
        </Markdown>
      </div>
      {zoom && (
        <div role="dialog" aria-modal="true" aria-label="Image" className="fixed inset-0 z-[80] grid place-items-center bg-black/90 p-3" onClick={() => setZoom(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="" className="max-h-full max-w-full rounded-xl object-contain" />
          <button type="button" aria-label="Close" className="absolute right-4 top-[calc(16px+var(--safe-top))] grid size-10 place-items-center rounded-full bg-white/15 text-white">
            <X className="size-5" />
          </button>
        </div>
      )}
    </>
  );
}
