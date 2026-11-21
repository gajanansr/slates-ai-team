/**
 * Resolve a post-sign-in `next` value to a same-origin path, or the fallback.
 * Parses with the URL constructor (which is what the browser/redirect will do),
 * so inputs like "/\\evil.com" or "/\t/evil.com" that normalise to another
 * origin are rejected.
 */
export function safeNext(next: string | null | undefined, origin: string, fallback = '/home'): string {
  if (!next || !next.startsWith('/')) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    const u = new URL(next, origin);
    if (u.origin !== new URL(origin).origin) return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}
