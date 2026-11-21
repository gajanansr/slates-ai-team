'use client';

import { useEffect } from 'react';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[app error]', error);
  }, [error]);
  return (
    <div className="card rise mt-10 p-6 text-center">
      <h2 className="text-lg font-semibold tracking-tight">Something went wrong</h2>
      <p className="mt-2 text-sm text-fg-3">{error.digest ? `Reference ${error.digest}` : 'Please try again.'}</p>
      {/* Client-side errors carry their real message (server ones are hidden behind the digest). */}
      {!error.digest && error.message && <p className="mx-auto mt-2 max-w-[46ch] break-words font-mono text-[12px] text-fg-4">{error.message.slice(0, 240)}</p>}
      <button type="button" onClick={reset} className="btn btn-glass mt-5">
        Try again
      </button>
    </div>
  );
}
