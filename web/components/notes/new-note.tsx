'use client';
import { useTransition } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { newNote } from '@/app/(app)/note-actions';

export function NewNoteButton() {
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn btn-glass btn-icon" aria-label="New note" disabled={pending} onClick={() => start(async () => void (await newNote('Untitled')))}>
      {pending ? <Loader2 className="size-[18px] animate-spin" /> : <Plus className="size-[18px]" strokeWidth={1.75} />}
    </button>
  );
}
