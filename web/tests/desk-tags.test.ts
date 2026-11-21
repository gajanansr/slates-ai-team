import { describe, expect, it } from 'vitest';
import { addresses, deskForAgent, tagsIn, type DeskItem } from '@/lib/desk';

const inst = (id: string, text: string, to?: string): DeskItem => ({ id, type: 'instruction', text, from: 'You', open: true, to });

describe('tagging agents', () => {
  it('finds @tags in what you wrote', () => {
    expect(tagsIn('@Claude tidy this, @instinct file it')).toEqual(['claude', 'instinct']);
    expect(tagsIn('mail me at a@b.com')).toEqual([]);
    expect(tagsIn('@claude @claude')).toEqual(['claude']);
  });

  it('matches a tag to the agent by name', () => {
    expect(addresses('claude', 'Claude')).toBe(true);
    expect(addresses('claude', 'Claude Code')).toBe(true);
    expect(addresses('instinct', 'Claude')).toBe(false);
    expect(addresses('claude,instinct', 'Instinct')).toBe(true);
    expect(addresses(undefined, 'Anything')).toBe(true);
  });

  it('shows an agent its own and untagged tasks, not those for others', () => {
    const items = [inst('i-1', '@claude a', 'claude'), inst('i-2', '@instinct b', 'instinct'), inst('i-3', 'c')];
    const ids = (me: string) => deskForAgent(items, me).instructions.map((i) => i.id);
    expect(ids('Claude')).toEqual(['i-1', 'i-3']);
    expect(ids('Instinct')).toEqual(['i-2', 'i-3']);
  });
});
