'use client';
import { useEffect, useState, useTransition } from 'react';
import { Download, Loader2, LogOut, Smartphone } from 'lucide-react';
import { clearOfflineCache } from '@/components/service-worker';
import { restoreSlate, setFlag } from '@/app/(app)/actions';

type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<unknown> };

export function InstallRow() {
  const [evt, setEvt] = useState<BIP | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    setStandalone(window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const h = (e: Event) => {
      e.preventDefault();
      setEvt(e as BIP);
    };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);

  const text = standalone
    ? 'Installed. You are using the app.'
    : evt
      ? 'Add Slates to your home screen.'
      : ios
        ? 'In Safari: Share → Add to Home Screen.'
        : "Use your browser's Install app option.";

  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <Smartphone className="size-[18px] flex-none text-fg-3" strokeWidth={1.6} />
      <div className="min-w-0 flex-1">
        <p className="text-[15px]">Install app</p>
        <p className="text-xs text-fg-3">{text}</p>
      </div>
      {evt && !standalone && (
        <button
          type="button"
          className="btn btn-primary h-9 px-4 text-sm"
          onClick={async () => {
            await evt.prompt();
            setEvt(null);
          }}
        >
          Install
        </button>
      )}
    </div>
  );
}

export function SignOutRow() {
  const [pending, setPending] = useState(false);
  return (
    <form
      action="/auth/signout"
      method="post"
      onSubmit={async () => {
        setPending(true);
        await clearOfflineCache();
      }}
    >
      <button className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-muted">
        {pending ? <Loader2 className="size-[18px] animate-spin text-fg-3" /> : <LogOut className="size-[18px] text-fg-3" strokeWidth={1.6} />}
        <span className="text-[15px]">Sign out</span>
      </button>
    </form>
  );
}

export function ExportRow() {
  return (
    <a href="/api/export" className="flex items-center gap-3 px-4 py-3.5 transition-colors active:bg-muted" download>
      <Download className="size-[18px] text-fg-3" strokeWidth={1.6} />
      <div>
        <p className="text-[15px]">Export data</p>
        <p className="text-xs text-fg-3">All slates and recent activity as JSON.</p>
      </div>
    </a>
  );
}

export function ExportNotesRow() {
  return (
    <a href="/api/export/notes" className="flex items-center gap-3 px-4 py-3.5 transition-colors active:bg-muted" download>
      <Download className="size-[18px] text-fg-3" strokeWidth={1.6} />
      <div>
        <p className="text-[15px]">Export notes</p>
        <p className="text-xs text-fg-3">Every note in one Markdown file you can read anywhere.</p>
      </div>
    </a>
  );
}

export function RestoreButton({ slug, kind }: { slug: string; kind: 'archived' | 'hidden' }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="h-8 rounded-full bg-muted px-3 text-[13px] text-fg-2 transition active:scale-95"
      disabled={pending}
      onClick={() => start(() => void (kind === 'archived' ? restoreSlate(slug) : setFlag(slug, 'hidden', false)))}
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : kind === 'archived' ? 'Restore' : 'Show'}
    </button>
  );
}
