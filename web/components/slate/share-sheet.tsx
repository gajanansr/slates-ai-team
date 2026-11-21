'use client';
import { useState, useTransition } from 'react';
import { Globe, Loader2 } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { CopyBlock } from '@/components/copy';
import { setShare } from '@/app/(app)/feature-actions';

/** A read-only public link to one board. Anyone with the link can view; turning it off kills the link. */
export function ShareSheet({ slug, token: initial, open, onClose }: { slug: string; token: string | null; open: boolean; onClose: () => void }) {
  const [token, setToken] = useState(initial);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const toggle = (on: boolean) =>
    start(async () => {
      setError('');
      const r = await setShare(slug, on);
      if (r.ok) setToken(r.data ?? null);
      else setError(r.error);
    });
  const url = token ? `${typeof window === 'undefined' ? '' : window.location.origin}/p/${token}` : '';
  return (
    <Sheet open={open} onClose={onClose} title="Public link">
      <div className="flex gap-3 rounded-2xl bg-muted p-3.5">
        <Globe className="mt-0.5 size-5 flex-none" strokeWidth={1.6} />
        <p className="text-sm leading-relaxed text-fg-2">
          Anyone with the link can <span className="text-fg">view</span> this board (read only, no history, no other boards). Good for build-in-public stats or a trip plan. Turn it off any time.
        </p>
      </div>
      {token ? (
        <div className="mt-4 space-y-3">
          <CopyBlock label="Link" text={url} />
          <button type="button" className="btn btn-glass w-full" disabled={pending} onClick={() => toggle(false)}>
            {pending && <Loader2 className="size-4 animate-spin" />} Turn off link
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-primary mt-4 w-full" disabled={pending} onClick={() => toggle(true)}>
          {pending && <Loader2 className="size-4 animate-spin" />} Create public link
        </button>
      )}
      {error && <p className="pt-2 text-sm text-fg">{error}</p>}
    </Sheet>
  );
}
