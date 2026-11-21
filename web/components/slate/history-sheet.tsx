'use client';
import { useEffect, useState, useTransition } from 'react';
import { History, Loader2, RotateCcw } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { listVersions, restoreVersion } from '@/app/(app)/feature-actions';
import type { VersionInfo } from '@/lib/history';
import { Ago } from '@/components/time';

/** Every saved version of a board, newest first. Restoring makes a new version (undoable). */
export function HistorySheet({ slug, open, onClose }: { slug: string; open: boolean; onClose: () => void }) {
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    setVersions(null);
    listVersions(slug).then((r) => (r.ok ? setVersions(r.data ?? []) : setError(r.error)));
  }, [open, slug]);

  const restore = (v: number) =>
    start(async () => {
      setBusy(v);
      setError('');
      const r = await restoreVersion(slug, v);
      setBusy(null);
      if (!r.ok) return setError(r.error);
      const again = await listVersions(slug);
      if (again.ok) setVersions(again.data ?? []);
    });

  return (
    <Sheet open={open} onClose={onClose} title="History">
      <p className="-mt-2 mb-3 text-sm text-fg-3">Every change by you or an agent is kept (last 60). Restoring adds a new version, so you can undo it too.</p>
      {!versions && !error && <div className="my-4 animate-pulse space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-12 rounded-[16px] border border-line bg-surface" />)}</div>}
      {versions && versions.length === 0 && <p className="py-4 text-sm text-fg-3">No history yet.</p>}
      <ol className="divide-y divide-line">
        {versions?.map((v) => (
          <li key={v.version} className="flex items-center gap-3 py-2.5">
            <span className="grid size-9 flex-none place-items-center rounded-xl bg-muted">
              <History className="size-4 text-fg-3" strokeWidth={1.7} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14.5px] font-medium">
                v{v.version} · {v.by}
              </span>
              <span className="block truncate text-[12.5px] text-fg-3">
                <Ago iso={v.created_at} />
                {v.title ? ` · ${v.title}` : ''}
              </span>
            </span>
            {v.current ? (
              <span className="pill">Current</span>
            ) : (
              <button type="button" onClick={() => restore(v.version)} disabled={busy !== null} className="btn btn-glass h-9 px-3 text-[13px]">
                {busy === v.version ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" strokeWidth={1.8} />}
                Restore
              </button>
            )}
          </li>
        ))}
      </ol>
      {error && <p className="pt-2 text-sm text-fg">{error}</p>}
    </Sheet>
  );
}
