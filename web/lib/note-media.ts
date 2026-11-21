/** Images inside a note are Markdown images whose URL is `att:<storage path>`; the page signs them. */
export const ATT = 'att:';
const IMG = /!\[[^\]]*\]\((att:[^)\s]+)\)/g;

/** Storage paths of every attached image in a note body. */
export function attPaths(body: string): string[] {
  return [...new Set([...body.matchAll(IMG)].map((m) => m[1].slice(ATT.length)))].slice(0, 50);
}

/** The Markdown to insert for an uploaded image. */
export const imageMarkdown = (path: string, alt = '') => `![${alt.replace(/[[\]]/g, '')}](${ATT}${path})`;

/** Flip the `[ ]` / `[x]` of the task list item that starts at `offset` in the source. */
export function toggleTaskAt(body: string, offset: number): string | null {
  const m = /^\s*(?:[-*+]|\d+[.)])\s+\[( |x|X)\]/.exec(body.slice(offset, offset + 40));
  if (!m) return null;
  const at = offset + m[0].length - 2;
  return body.slice(0, at) + (m[1] === ' ' ? 'x' : ' ') + body.slice(at + 1);
}

/** Voice clips ride in the same Markdown image syntax; the file extension tells them apart. */
export const isAudioPath = (path: string) => /\.(webm|m4a|mp4|ogg|mp3|aac)$/i.test(path);
export const voiceMarkdown = (path: string) => `![Voice note](${ATT}${path})`;

/** One note as a Markdown document: title, tags and when it was edited, then the body. */
export function noteMarkdown(n: { title: string; body: string; tags?: string[]; updated_at?: string; by?: string }) {
  const meta = [n.tags?.length ? `Tags: ${n.tags.join(', ')}` : '', n.updated_at ? `Edited ${n.updated_at.slice(0, 10)}${n.by ? ` by ${n.by}` : ''}` : ''].filter(Boolean).join(' · ');
  return `# ${n.title}\n${meta ? `\n_${meta}_\n` : ''}\n${n.body.trim()}\n`;
}

/**
 * Live blocks inside a note, written as fenced code:
 *   ```chart   + the same JSON a chart board takes   -> a chart
 *   ```board   + a board slug, or slug/widget-id     -> that board or widget, live
 */
export type EmbedBlock = { lang: 'chart' | 'board'; code: string; key: string };
export const embedKey = (lang: string, code: string) => `${lang}:${code.trim()}`;
export function embedBlocks(body: string): EmbedBlock[] {
  const out: EmbedBlock[] = [];
  for (const m of body.matchAll(/^```(chart|board)[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm)) {
    const lang = m[1] as EmbedBlock['lang'];
    const key = embedKey(lang, m[2]);
    if (!out.some((b) => b.key === key)) out.push({ lang, code: m[2].trim(), key });
  }
  return out.slice(0, 12);
}

/**
 * Clips recorded in the browser carry no length, so players show 0:00 / 0:00 until played.
 * Seeking far past the end makes the browser work the length out; then we return to the start.
 */
export function fixClipLength(a: HTMLAudioElement) {
  if (Number.isFinite(a.duration) && a.duration > 0) return;
  const back = () => {
    a.removeEventListener('timeupdate', back);
    a.currentTime = 0;
  };
  a.addEventListener('timeupdate', back);
  try {
    a.currentTime = 1e9;
  } catch {
    a.removeEventListener('timeupdate', back);
  }
}
