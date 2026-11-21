'use client';
import { useState, useTransition } from 'react';
import { Loader2, Pencil } from 'lucide-react';
import { saveMarkdown } from '@/app/(app)/actions';

export function MarkdownEditor({ slug, body, version, children }: { slug: string; body: string; version: number; children: React.ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(body);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  if (!editing) {
    return (
      <div>
        {children}
        <button type="button" className="btn btn-glass mt-5" onClick={() => { setValue(body); setEditing(true); }}>
          <Pencil className="size-4" strokeWidth={1.75} /> Edit
        </button>
      </div>
    );
  }
  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={14}
        className="field h-auto min-h-[50dvh] resize-y py-3 font-mono text-[14px] leading-relaxed"
        autoFocus
      />
      {error && <p className="mt-2 text-sm text-fg">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn btn-glass" onClick={() => setEditing(false)}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await saveMarkdown(slug, value, version);
              if (r.ok) setEditing(false);
              else setError(/version/i.test(r.error) ? 'An agent changed this note while you were editing. Copy your text, reload, and try again.' : r.error);
            })
          }
        >
          {pending && <Loader2 className="size-4 animate-spin" />} Save
        </button>
      </div>
    </div>
  );
}
