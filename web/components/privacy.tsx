'use client';
import { useEffect, useState } from 'react';
import { EyeOff } from 'lucide-react';

import { PRIVACY_KEY as KEY } from '@/lib/privacy-boot';

function usePrivacy() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(document.documentElement.classList.contains('privacy-on'));
  }, []);
  const toggle = () => {
    const next = !on;
    document.documentElement.classList.toggle('privacy-on', next);
    try {
      if (next) localStorage.setItem(KEY, '1');
      else localStorage.removeItem(KEY);
    } catch {}
    setOn(next);
  };
  return [on, toggle] as const;
}

export function PrivacyRow() {
  const [on, toggle] = usePrivacy();
  return (
    <label className="flex cursor-pointer items-center gap-3 px-4 py-3.5">
      <EyeOff className="size-[18px] flex-none text-fg-3" strokeWidth={1.6} />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px]">Hide values</span>
        <span className="block text-xs text-fg-3">Blur amounts and numbers on this device, e.g. when sharing your screen.</span>
      </span>
      <input type="checkbox" role="switch" checked={on} onChange={toggle} className="peer sr-only" />
      <span
        aria-hidden
        className="relative h-[26px] w-[44px] flex-none rounded-full bg-muted transition-colors peer-checked:bg-btn after:absolute after:left-[3px] after:top-[3px] after:size-5 after:rounded-full after:bg-surface after:shadow after:transition-transform peer-checked:after:translate-x-[18px] peer-checked:after:bg-on-btn"
      />
    </label>
  );
}
