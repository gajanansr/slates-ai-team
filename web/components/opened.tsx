'use client';
import { useEffect } from 'react';

/**
 * Per-item "seen" for Home's "Since you last looked": each board or automation clears on its own
 * when you open it, instead of everything clearing when you leave Home. Kept on this device.
 */
const KEY = 'slates-opened';

export function readOpened(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

export function markOpened(keys: string[]) {
  try {
    const m = readOpened();
    const now = Date.now();
    for (const k of keys) m[k] = now;
    // Keep the newest 300 entries.
    const kept = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 300);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* storage unavailable: the item just stays listed */
  }
}

/** Drop into a page: marks these items as opened. */
export function MarkOpened({ keys }: { keys: string[] }) {
  const k = keys.join('|');
  useEffect(() => {
    markOpened(k.split('|').filter(Boolean));
  }, [k]);
  return null;
}
