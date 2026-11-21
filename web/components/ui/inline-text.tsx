'use client';
import Link from 'next/link';

import { INLINE_LINK as LINK } from '@/lib/inline';

/** Safe target: an app path or http(s). Anything else renders as plain text. */
const safe = (u: string) => (u.startsWith('/') && !u.startsWith('//') ? 'in' : /^https?:\/\//i.test(u) ? 'out' : null);

/**
 * Agents often write Markdown links in short text ("Review [bugs](/s/bugs)"). Render those as real
 * links and tidy **bold** / `code` marks, without pulling in a full Markdown renderer.
 */
export function InlineText({ text, className = 'underline decoration-current/40 underline-offset-2' }: { text: string; className?: string }) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(LINK)) {
    const i = m.index ?? 0;
    if (i > last) out.push(tidy(text.slice(last, i)));
    const kind = safe(m[2]);
    if (kind === 'in') {
      out.push(
        <Link key={n++} href={m[2]} className={className} onClick={(e) => e.stopPropagation()}>
          {m[1]}
        </Link>,
      );
    } else if (kind === 'out') {
      out.push(
        <a key={n++} href={m[2]} target="_blank" rel="noopener noreferrer" className={className} onClick={(e) => e.stopPropagation()}>
          {m[1]}
        </a>,
      );
    } else out.push(m[1]);
    last = i + m[0].length;
  }
  if (last < text.length) out.push(tidy(text.slice(last)));
  return <>{out}</>;
}

const tidy = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
