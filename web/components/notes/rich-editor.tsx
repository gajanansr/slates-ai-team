'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import { remarkGfmSafe } from '@/lib/markdown';
import { ATT, fixClipLength, isAudioPath } from '@/lib/note-media';
import { htmlToMarkdown } from '@/lib/rich-md';

export type RichCommand = 'h2' | 'bold' | 'italic' | 'task' | 'ul' | 'ol' | 'quote';
/** Which formats apply where the cursor is, so the bar can light the matching buttons. */
export type RichState = Partial<Record<RichCommand, boolean>>;
export type RichHandle = { run: (cmd: RichCommand) => void; insertBlock: (md: string, preview?: { kind: 'audio' | 'image'; url: string }) => void; focus: () => void };

/** What a block the editor carries untouched says about itself. */
function atomLabel(md: string): string {
  const t = md.trim();
  if (t.startsWith('```chart')) return 'Chart';
  if (t.startsWith('```board')) return `Board · ${t.split('\n')[1]?.trim() ?? ''}`;
  if (t.startsWith('```')) return 'Code';
  if (t.startsWith('|')) return 'Table';
  if (/^!\[[^\]]*\]\(att:/.test(t)) return isAudioPath(t.slice(0, -1)) ? 'Voice note' : 'Photo';
  if (t.startsWith('![')) return 'Image';
  return 'Block';
}

/** Markdown -> what the editor starts from. Uneditable blocks keep their source in data-md. */
function startTree(source: string, urls: Record<string, string>): React.ReactNode {
  const slice = (node: any, fallback: string) => {
    const s = node?.position?.start?.offset;
    const e = node?.position?.end?.offset;
    return typeof s === 'number' && typeof e === 'number' ? source.slice(s, e) : fallback;
  };
  const remove = (
    <button type="button" data-atom-remove="1" aria-label="Remove" className="md-atom-x">
      ×
    </button>
  );
  const atom = (md: string, preview?: React.ReactNode) => (
    <div className="md-atom" contentEditable={false} data-block="1" data-md={md}>
      <span className="md-atom-body">{preview ?? atomLabel(md)}</span>
      {remove}
    </div>
  );
  return (
    <Markdown
      remarkPlugins={[remarkGfmSafe]}
      urlTransform={(url) => (url.startsWith(ATT) ? url : defaultUrlTransform(url))}
      components={{
        pre: ({ node }) => atom(slice(node, '')),
        table: ({ node }) => atom(slice(node, '')),
        hr: () => <hr />,
        input: () => null,
        ul: ({ node: _n, className, children }) => (String(className ?? '').includes('contains-task-list') ? <ul data-task="1">{children}</ul> : <ul>{children}</ul>),
        li: ({ node, className, children }) => {
          if (!String(className ?? '').includes('task-list-item')) return <li>{children}</li>;
          const box = (node?.children ?? []).find((c: any) => c.type === 'element' && c.tagName === 'input') as any;
          return <li data-checked={box?.properties?.checked ? 'true' : 'false'}>{children}</li>;
        },
        img: ({ node, src, alt }) => {
          const md = slice(node, `![${alt ?? ''}](${src ?? ''})`);
          const s = typeof src === 'string' ? (src.startsWith(ATT) ? urls[src.slice(ATT.length)] : src) : undefined;
          const audio = typeof src === 'string' && isAudioPath(src);
          return (
            <span className="md-atom md-atom-inline" contentEditable={false} data-md={md}>
              <span className="md-atom-body">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {s && audio ? <audio controls preload="metadata" src={s} onLoadedMetadata={(e) => fixClipLength(e.currentTarget)} /> : s ? <img src={s} alt="" /> : atomLabel(md)}
              </span>
              {remove}
            </span>
          );
        },
      }}
    >
      {source}
    </Markdown>
  );
}

const closest = (n: Node | null, sel: string, root: HTMLElement): HTMLElement | null => {
  const el = n && (n.nodeType === 1 ? (n as HTMLElement) : n.parentElement);
  const hit = el?.closest<HTMLElement>(sel) ?? null;
  return hit && root.contains(hit) ? hit : null;
};

/**
 * The note editor: you see bold as bold and a checklist as checkboxes, never the Markdown marks.
 * It reads and writes Markdown underneath, so agents and the reading view are unchanged.
 */
export const RichEditor = forwardRef<RichHandle, { initial: string; urls?: Record<string, string>; onChange: (markdown: string) => void; onState?: (state: RichState) => void; placeholder?: string }>(function RichEditor(
  { initial, urls = {}, onChange, onState, placeholder },
  ref,
) {
  const box = useRef<HTMLDivElement>(null);
  // Where the cursor last was in the note, so a button or menu that takes focus can hand it back.
  const last = useRef<Range | null>(null);
  const restore = () => {
    const root = box.current;
    if (!root) return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount && root.contains(sel.anchorNode)) return;
    root.focus();
    if (last.current && root.contains(last.current.startContainer)) {
      sel?.removeAllRanges();
      sel?.addRange(last.current);
    }
  };
  const report = () => {
    const root = box.current;
    const sel = window.getSelection();
    if (root && sel?.rangeCount && sel.anchorNode && root.contains(sel.anchorNode)) last.current = sel.getRangeAt(0).cloneRange();
    if (!root || !onState || !sel?.anchorNode || !root.contains(sel.anchorNode)) return;
    const at = sel.anchorNode;
    const q = (c: string) => {
      try {
        return document.queryCommandState(c);
      } catch {
        return false;
      }
    };
    const task = !!closest(at, 'ul[data-task], li[data-checked]', root);
    onState({ bold: q('bold'), italic: q('italic'), h2: !!closest(at, 'h1,h2,h3', root), quote: !!closest(at, 'blockquote', root), task, ul: !task && !!closest(at, 'ul', root) && !closest(at, 'ol', root), ol: !!closest(at, 'ol', root) });
  };
  const emit = () => {
    if (box.current) onChange(htmlToMarkdown(box.current as any));
    report();
  };
  // The lit buttons follow the cursor.
  useEffect(() => {
    document.addEventListener('selectionchange', report);
    return () => document.removeEventListener('selectionchange', report);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drawn once: the same element is handed back on every render, so React never touches
  // the content again and the browser owns it from here.
  const tree = useRef<React.ReactNode>(null);
  if (tree.current === null) tree.current = startTree(initial, urls) ?? false;
  useEffect(() => {
    try {
      document.execCommand('defaultParagraphSeparator', false, 'p');
    } catch {
      /* older browsers: paragraphs become divs, which serialise the same way */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inside = () => {
    const sel = window.getSelection();
    return sel && sel.rangeCount && box.current?.contains(sel.anchorNode) ? sel : null;
  };

  useImperativeHandle(ref, () => ({
    focus: () => box.current?.focus(),
    run(cmd) {
      const root = box.current;
      if (!root) return;
      restore();
      const sel = window.getSelection();
      const at = sel?.anchorNode ?? null;
      const collapsed = !!sel?.isCollapsed;
      const exec = (c: string, v?: string) => document.execCommand(c, false, v);
      // A heading or quote cannot live inside a list item: take the line out of the list first.
      if (cmd === 'h2' || cmd === 'quote') {
        const list = closest(at, 'ul,ol', root);
        if (list) {
          list.removeAttribute('data-task');
          exec(list.tagName === 'OL' ? 'insertOrderedList' : 'insertUnorderedList');
          closest(window.getSelection()?.anchorNode ?? null, '[data-checked]', root)?.removeAttribute('data-checked');
        }
      }
      if (cmd === 'bold' || cmd === 'italic') exec(cmd);
      else if (cmd === 'h2') exec('formatBlock', closest(at, 'h1,h2,h3', root) ? 'p' : 'h2');
      else if (cmd === 'quote') exec('formatBlock', closest(at, 'blockquote', root) ? 'p' : 'blockquote');
      else if (cmd === 'ol') exec('insertOrderedList');
      else if (cmd === 'ul') {
        const task = closest(at, 'ul[data-task]', root);
        if (task) {
          task.removeAttribute('data-task');
          task.querySelectorAll(':scope > li').forEach((li) => li.removeAttribute('data-checked'));
        } else exec('insertUnorderedList');
      } else if (cmd === 'task') {
        let ul = closest(at, 'ul', root);
        if (!ul) {
          // On an empty line the cursor reports the editor itself, so find the list that just appeared.
          const before = new Set<Element>(root.querySelectorAll('ul'));
          exec('insertUnorderedList');
          ul = closest(window.getSelection()?.anchorNode ?? null, 'ul', root) ?? [...root.querySelectorAll<HTMLElement>('ul')].find((u) => !before.has(u)) ?? null;
        }
        if (ul) {
          const on = !ul.hasAttribute('data-task');
          ul.toggleAttribute('data-task', on);
          ul.querySelectorAll(':scope > li').forEach((li) => (on ? li.setAttribute('data-checked', li.getAttribute('data-checked') ?? 'false') : li.removeAttribute('data-checked')));
        }
      }
      // Turning a line into a list can throw the cursor to its start; put it back at the end of the item.
      if ((cmd === 'ul' || cmd === 'ol' || cmd === 'task') && collapsed) {
        const now = window.getSelection();
        const li = closest(now?.anchorNode ?? null, 'li', root) ?? [...root.querySelectorAll<HTMLElement>('li')].find((x) => at && x.contains(at)) ?? null;
        if (li && now) {
          const r = document.createRange();
          r.selectNodeContents(li);
          r.collapse(false);
          now.removeAllRanges();
          now.addRange(r);
        }
      }
      emit();
    },
    insertBlock(md, preview) {
      const root = box.current;
      if (!root) return;
      const atom = document.createElement('div');
      atom.className = 'md-atom';
      atom.contentEditable = 'false';
      atom.setAttribute('data-block', '1');
      atom.setAttribute('data-md', md);
      const bodyEl = document.createElement('span');
      bodyEl.className = 'md-atom-body';
      if (preview?.kind === 'audio') {
        const a = document.createElement('audio');
        a.controls = true;
        a.preload = 'metadata';
        a.addEventListener('loadedmetadata', () => fixClipLength(a));
        a.src = preview.url;
        bodyEl.appendChild(a);
      } else if (preview?.kind === 'image') {
        const i = document.createElement('img');
        i.src = preview.url;
        i.alt = '';
        bodyEl.appendChild(i);
      } else bodyEl.textContent = atomLabel(md);
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'md-atom-x';
      x.setAttribute('data-atom-remove', '1');
      x.setAttribute('aria-label', 'Remove');
      x.textContent = '×';
      atom.append(bodyEl, x);
      const after = document.createElement('p');
      after.appendChild(document.createElement('br'));
      // Put it after the block the cursor is in (or at the end), never inside a paragraph.
      let anchor: Node | null = inside()?.anchorNode ?? (last.current && root.contains(last.current.startContainer) ? last.current.startContainer : null);
      while (anchor && anchor.parentNode !== root) anchor = anchor.parentNode;
      if (anchor) (anchor as ChildNode).after(atom, after);
      else root.append(atom, after);
      const range = document.createRange();
      range.setStart(after, 0);
      range.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      emit();
    },
  }));

  return (
    <div
      ref={box}
      role="textbox"
      aria-multiline="true"
      aria-label="Note"
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      className="rich-note prose-slate prose-note min-h-[40dvh] py-1 outline-none"
      onInput={(e) => {
        // A new checklist line starts unticked, even when the one above was ticked.
        if ((e.nativeEvent as InputEvent).inputType === 'insertParagraph' && box.current) {
          const li = closest(window.getSelection()?.anchorNode ?? null, 'li[data-checked]', box.current);
          if (li) li.setAttribute('data-checked', 'false');
        }
        emit();
      }}
      onMouseDown={(e) => {
        // Ticking a box must not move the cursor into that line.
        const li = e.target as HTMLElement;
        if (li.matches?.('li[data-checked]') && e.clientX - li.getBoundingClientRect().left <= 30) e.preventDefault();
      }}
      onClick={(e) => {
        // The × on a photo, voice note or chart takes it out of the note.
        const x = (e.target as HTMLElement).closest?.('[data-atom-remove]');
        if (x) {
          e.preventDefault();
          x.closest('[data-md]')?.remove();
          emit();
          return;
        }
        // The checkbox is drawn in the item's left gutter; a tap there ticks it.
        const li = (e.target as HTMLElement).closest?.('li[data-checked]') as HTMLElement | null;
        if (!li || e.target !== li) return;
        if (e.clientX - li.getBoundingClientRect().left > 30) return;
        li.setAttribute('data-checked', li.getAttribute('data-checked') === 'true' ? 'false' : 'true');
        emit();
      }}
      onPaste={(e) => {
        // Paste as plain text so no foreign styling gets in.
        if (e.clipboardData.files.length) return;
        e.preventDefault();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
      }}
    >
      {tree.current}
    </div>
  );
});
