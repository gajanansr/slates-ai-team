'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Grip, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { toggleShortcut } from '@/app/(app)/actions';
import { offerUndo } from '@/lib/undo';
import { NoteToolbar } from '@/components/notes/note-toolbar';
import { RichEditor, type RichHandle, type RichState } from '@/components/notes/rich-editor';
import { NoteExport } from '@/components/notes/note-export';
import type { Note } from '@/lib/kinds';
import { deleteNote, saveNote, uploadNoteImage } from '@/app/(app)/note-actions';
import { compressImage } from '@/components/notes/compress-image';
import { imageMarkdown, voiceMarkdown } from '@/lib/note-media';
import { VoiceButton } from '@/components/notes/voice-button';

const parseTags = (s: string) =>
  [...new Set(s.split(',').map((t) => t.trim().toLowerCase().slice(0, 24)).filter(Boolean))].slice(0, 8);

/** Read/edit toggle for one note. The rendered Markdown arrives as children. */
export function NoteEditor({ note, startEditing = false, shortcut = false, boards = [], urls = {}, children }: { note: Note; startEditing?: boolean; shortcut?: boolean; boards?: { slug: string; title: string }[]; urls?: Record<string, string>; children: React.ReactNode }) {
  const [editing, setEditing] = useState(startEditing);
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [tags, setTags] = useState((note.tags ?? []).join(', '));
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const rich = useRef<RichHandle>(null);
  const [active, setActive] = useState<RichState>({});
  // Editing takes the whole screen: the tab bar steps aside until you save or cancel.
  useEffect(() => {
    if (!editing) return;
    document.documentElement.dataset.editing = '1';
    return () => {
      delete document.documentElement.dataset.editing;
    };
  }, [editing]);
  const picker = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  // The editor is its own full screen (like Keep), drawn on the body so no page transform can move it.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Images are shrunk on the device, uploaded, and dropped in at the cursor as Markdown.
  const addImages = async (files: File[]) => {
    const list = files.filter((f) => f.type.startsWith('image/')).slice(0, 6);
    if (!list.length) return;
    setError('');
    setUploading(list.length);
    const at = 0;
    const added: string[] = [];
    for (const f of list) {
      const small = await compressImage(f);
      const fd = new FormData();
      fd.append('file', small);
      const r = await uploadNoteImage(fd);
      if (r.ok) {
        const url = blobUrl(small);
        rich.current?.insertBlock(imageMarkdown(r.path, f.name.replace(/\.[^.]+$/, '')), url ? { kind: 'image', url } : undefined);
      } else setError(r.error);
      setUploading((n) => n - 1);
    }
  };
  const insertAt = (_at: number, blocks: string[]) => blocks.forEach((b) => rich.current?.insertBlock(b));
  const blobUrl = (f: Blob) => {
    try {
      return URL.createObjectURL(f);
    } catch {
      return '';
    }
  };
  const addVoice = async (clip: File) => {
    setError('');
    setUploading((n) => n + 1);
    const at = 0;
    const fd = new FormData();
    fd.append('file', clip);
    const r = await uploadNoteImage(fd);
    if (r.ok) {
      const url = blobUrl(clip);
      rich.current?.insertBlock(voiceMarkdown(r.path), url ? { kind: 'audio', url } : undefined);
    }
    else setError(r.error);
    setUploading((n) => n - 1);
  };



  if (!editing) {
    const icon = 'grid size-9 place-items-center rounded-full text-fg-3 transition hover:bg-muted hover:text-fg active:scale-95 disabled:opacity-50';
    const edit = () => {
      setTitle(note.title);
      setBody(note.body);
      setTags((note.tags ?? []).join(', '));
      setEditing(true);
    };
    return (
      <div>
        {/* Small icon actions in the card's corner, instead of a row of big buttons under the note. */}
        <div className="-mr-1.5 -mt-1.5 mb-1 flex justify-end gap-0.5">
          <button type="button" className={icon} onClick={edit} aria-label="Edit note" title="Edit">
            <Pencil className="size-[18px]" strokeWidth={1.75} />
          </button>
          <button type="button" className={icon} disabled={pending && !confirm} onClick={() => start(async () => void (await saveNote(note.id, { pinned: !note.pinned })))} aria-label={note.pinned ? 'Unpin note' : 'Pin note'} title={note.pinned ? 'Unpin' : 'Pin'}>
            {note.pinned ? <PinOff className="size-[18px]" strokeWidth={1.75} /> : <Pin className="size-[18px]" strokeWidth={1.75} />}
          </button>
          <button type="button" className={`${icon} ${shortcut ? 'text-fg' : ''}`} disabled={pending && !confirm} onClick={() => start(async () => { const r = await toggleShortcut({ type: 'note', id: note.id }); if (!r.ok) setError(r.error); })} aria-pressed={shortcut} aria-label={shortcut ? 'Remove from shortcuts' : 'Add to shortcuts'} title={shortcut ? 'In your shortcuts' : 'Add to shortcuts'}>
            <Grip className="size-[18px]" strokeWidth={shortcut ? 2.4 : 1.75} />
          </button>
          <NoteExport note={note} />
          {confirm ? (
            <button type="button" autoFocus className="flex h-9 items-center gap-1.5 rounded-full bg-accent px-3 text-[13px] font-medium text-on-accent active:scale-95" disabled={pending} onClick={() => { offerUndo({ label: 'Note deleted', undo: { type: 'version', slug: 'notes' } }); start(async () => void (await deleteNote(note.id))); }} onBlur={() => setConfirm(false)}>
              <Trash2 className="size-4" strokeWidth={1.75} /> {pending ? 'Deleting' : 'Delete?'}
            </button>
          ) : (
            <button type="button" className={icon} onClick={() => setConfirm(true)} aria-label="Delete note" title="Delete">
              <Trash2 className="size-[18px]" strokeWidth={1.75} />
            </button>
          )}
        </div>
        {error && <p className="mb-2 text-sm text-fg">{error}</p>}
        {/* Double-tap the text to start editing, like most notes apps. */}
        <div onDoubleClick={edit}>{children}</div>
      </div>
    );
  }

  if (!mounted) return <div>{children}</div>;
  const form = (
    <form
      className="fixed inset-0 z-[80] flex flex-col bg-[var(--page)] pt-[var(--safe-top)] text-fg"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveNote(note.id, { title, body, tags: parseTags(tags) });
          if (r.ok) setEditing(false);
          else setError(/version/i.test(r.error) ? 'An agent changed your notes while you were editing. Copy your text, reload, and try again.' : r.error);
        });
      }}
    >
      {/* Top: back (discard) and Save. Nothing else, so the note has the room. */}
      <div className="flex flex-none items-center justify-between px-3 py-2.5">
        <button type="button" aria-label="Back without saving" className="grid size-11 place-items-center rounded-full text-fg-2 active:bg-muted" onClick={() => setEditing(false)}>
          <ArrowLeft className="size-[22px]" strokeWidth={1.8} />
        </button>
        <button type="submit" className={`btn btn-primary h-10 px-6 text-[14.5px] ${pending ? 'animate-pulse' : ''}`} disabled={pending || uploading > 0}>
          {pending ? 'Saving' : 'Save'}
        </button>
      </div>
      {/* Only this part scrolls. */}
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6"
        onPaste={(e) => {
          const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
          if (files.length) {
            e.preventDefault();
            void addImages(files);
          }
        }}
      >
        <input
          id="note-title"
          aria-label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          placeholder="Title"
          className="mb-3 mt-1 w-full bg-transparent text-[28px] font-medium leading-tight tracking-[-0.03em] outline-none placeholder:text-fg-4"
          autoFocus={!note.body}
        />
        <RichEditor ref={rich} initial={note.body} urls={urls} onChange={setBody} onState={setActive} placeholder="Note" />
        <input
          id="note-tags"
          aria-label="Tags"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="Add tags, e.g. work, ideas"
          autoCapitalize="none"
          autoCorrect="off"
          className="mt-6 w-full bg-transparent text-[14.5px] text-fg-2 outline-none placeholder:text-fg-4"
        />
        {error && <p className="mt-3 text-sm text-fg">{error}</p>}
      </div>
      <input ref={picker} type="file" accept="image/*" multiple hidden onChange={(e) => { void addImages([...(e.target.files ?? [])]); e.target.value = ''; }} />
      {/* The bar sits just above the keyboard, flat, with no card around it. */}
      <div className="flex-none border-t border-line px-2 pb-[calc(6px+var(--safe-bottom))] pt-1.5">
        <NoteToolbar
          run={(cmd) => rich.current?.run(cmd)}
          active={active}
          onInsert={(block) => rich.current?.insertBlock(block)}
          onPhoto={() => picker.current?.click()}
          voice={<VoiceButton disabled={uploading > 0} onClip={addVoice} onError={setError} />}
          busy={uploading > 0}
          boards={boards}
        />
      </div>
    </form>
  );
  return createPortal(form, document.body);
}
