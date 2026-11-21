'use client';
import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import type { FileRefT } from '@/lib/kinds';
import { signFiles } from '@/app/(app)/feature-actions';

/** Thumbnails for attached images/PDFs. URLs are short-lived and signed for the owner only. */
export function Attachments({ files, title = 'Attachments' }: { files: FileRefT[]; title?: string }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    signFiles(files.map((f) => f.path)).then(setUrls);
  }, [files]);
  return (
    <div className="mt-4 border-t border-line pt-4">
      <p className="kicker mb-2">{title}</p>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {files.map((f) => {
          const u = urls[f.path];
          return (
            <li key={f.path}>
              <a href={u} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-2xl bg-muted" aria-label={`Open ${f.name}`}>
                {f.type?.startsWith('image/') && u ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={u} alt={f.name} className="aspect-square w-full object-cover" loading="lazy" />
                ) : (
                  <span className="grid aspect-square place-items-center p-2 text-center text-[11px] text-fg-3">
                    <FileText className="mb-1 size-5" strokeWidth={1.6} />
                    <span className="line-clamp-2">{f.name}</span>
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
