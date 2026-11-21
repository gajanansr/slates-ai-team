'use client';
import { useEffect } from 'react';
import { openCommand } from '@/components/command';
import { Search } from 'lucide-react';

/** When the user leaves Home, "since you last looked" restarts from now. */
export function SeenBeacon() {
  useEffect(() => {
    let sent = false;
    const mark = () => {
      if (sent || document.visibilityState !== 'hidden') return;
      sent = navigator.sendBeacon?.('/api/seen') ?? false;
    };
    document.addEventListener('visibilitychange', mark);
    return () => {
      document.removeEventListener('visibilitychange', mark);
      if (!sent) navigator.sendBeacon?.('/api/seen');
    };
  }, []);
  return null;
}

export function SearchButton({ className = '' }: { className?: string }) {
  return (
    <button type="button" onClick={openCommand} aria-label="Search" className={`grid size-11 place-items-center rounded-full bg-muted transition-transform active:scale-95 ${className}`}>
      <Search className="size-[19px]" strokeWidth={1.8} />
    </button>
  );
}
