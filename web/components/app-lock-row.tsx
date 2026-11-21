'use client';
import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { disableLock, enableLock, lockEnabled, lockSupported } from '@/components/app-lock';

export function AppLockRow({ email }: { email?: string }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [on, setOn] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    lockSupported().then(setSupported);
    setOn(lockEnabled());
  }, []);
  const toggle = async () => {
    setError('');
    if (on) {
      disableLock();
      setOn(false);
      return;
    }
    try {
      await enableLock(email ?? '');
      sessionStorage.setItem('slates.unlocked', '1');
      setOn(true);
    } catch {
      setError("Couldn't turn on the lock on this device.");
    }
  };
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <Lock className="size-[18px] flex-none text-fg-3" strokeWidth={1.6} />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px]">App lock</span>
        <span className="block text-xs text-fg-3">
          {supported === false ? 'Needs Face ID, Touch ID or a device passcode' : error || 'Face ID or passcode to open Slates on this device'}
        </span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="App lock"
        disabled={!supported}
        onClick={toggle}
        className={`relative h-7 w-12 flex-none rounded-full transition-colors disabled:opacity-40 ${on ? 'bg-btn' : 'bg-muted'}`}
      >
        <span className={`absolute top-1 size-5 rounded-full bg-surface shadow transition-[left] ${on ? 'left-6' : 'left-1'}`} />
      </button>
    </div>
  );
}
