'use client';
import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { revokeAgent } from '@/app/(app)/actions';

export function RevokeButton({ id, name }: { id: string; name: string }) {
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  if (!confirm) {
    return (
      <button type="button" className="h-8 rounded-full px-3 text-[13px] text-fg-3 transition-colors hover:text-fg" onClick={() => setConfirm(true)}>
        Revoke
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <button type="button" className="h-8 rounded-full px-3 text-[13px] text-fg-3" onClick={() => setConfirm(false)}>
        Keep
      </button>
      <button
        type="button"
        aria-label={`Revoke ${name}`}
        className="flex h-8 items-center gap-1.5 rounded-full bg-btn px-3 text-[13px] font-medium text-on-btn"
        disabled={pending}
        onClick={() => start(() => void revokeAgent(id))}
      >
        {pending && <Loader2 className="size-3.5 animate-spin" />} Revoke
      </button>
    </span>
  );
}
