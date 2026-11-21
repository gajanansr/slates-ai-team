import { ViewTransition } from 'react';

const DIRECTIONAL = { 'nav-forward': 'nav-forward', 'nav-back': 'nav-back', default: 'none' } as const;

/** Wrap each page so forward/back navigations slide like a native stack. Tabs stay instant. */
export function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter={DIRECTIONAL} exit={DIRECTIONAL} default="none">
      <div>{children}</div>
    </ViewTransition>
  );
}
