'use client';
import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

function part(h: number) {
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Local-time greeting and date; rendered on the client so it matches the viewer's clock. */
export function Greeting() {
  const text = useSyncExternalStore(subscribe, () => part(new Date().getHours()), () => 'Hello');
  return <>{text}</>;
}

export function TodayDate() {
  const text = useSyncExternalStore(
    subscribe,
    () => new Date().toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long' }),
    () => ' ',
  );
  return <>{text}</>;
}
