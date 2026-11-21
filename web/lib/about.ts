import { notes } from '@/lib/notes';
import { SlatesError, type Caller } from '@/lib/slates';
import { ABOUT_ID } from '@/lib/about-id';

/**
 * Shared memory: one note every agent reads first, so what you tell one assistant the others
 * know too. It is an ordinary note (id "about-me"), so it has history and you can edit it.
 */
export { ABOUT_ID };
const STARTER = `Everything here is read by every agent you connect, at the start of each conversation.

## Me

## Work and projects

## People

## Preferences
`;

export const about = {
  /** The note, or null when nothing has been remembered yet. */
  async get(c: Caller) {
    try {
      return await notes.get(c, ABOUT_ID);
    } catch (e) {
      if (e instanceof SlatesError && e.status === 404) return null;
      throw e;
    }
  },

  async ensure(c: Caller) {
    return (await about.get(c)) ?? (await notes.add(c, { id: ABOUT_ID, title: 'About me', body: STARTER, pinned: true }));
  },

  /** Add one durable fact, under a section when it exists (else at the end). Skips exact repeats. */
  async remember(c: Caller, fact: string, section?: string) {
    const line = `- ${fact.trim().replace(/\s+/g, ' ')}`;
    const cur = await about.ensure(c);
    if (cur.body.toLowerCase().includes(line.toLowerCase())) return { remembered: false, reason: 'already known' };
    const lines = cur.body.split('\n');
    const head = section ? lines.findIndex((l) => /^#{1,3}\s/.test(l) && l.replace(/^#+\s*/, '').trim().toLowerCase() === section.trim().toLowerCase()) : -1;
    if (head < 0) {
      await notes.update(c, ABOUT_ID, { body: `${cur.body.trimEnd()}\n${section ? `\n## ${section.trim()}\n` : ''}${line}\n` });
    } else {
      // Insert after the section's last non-empty line, before the next heading.
      let end = lines.findIndex((l, i) => i > head && /^#{1,3}\s/.test(l));
      if (end < 0) end = lines.length;
      let at = end;
      while (at > head + 1 && !lines[at - 1].trim()) at--;
      lines.splice(at, 0, line);
      await notes.update(c, ABOUT_ID, { body: lines.join('\n') });
    }
    return { remembered: true };
  },
};
