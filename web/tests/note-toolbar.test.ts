import { describe, expect, it } from 'vitest';
import { continueList, insertBlock, prefixLines, wrap } from '@/components/notes/note-toolbar';

describe('note formatting without typing Markdown', () => {
  it('bold wraps the selection, or a placeholder when nothing is selected', () => {
    expect(wrap({ value: 'buy milk', start: 4, end: 8 }, '**', 'bold')).toEqual({ value: 'buy **milk**', start: 6, end: 10 });
    expect(wrap({ value: '', start: 0, end: 0 }, '**', 'bold').value).toBe('**bold**');
  });
  it('checklist turns the selected lines into tasks, swaps other list marks, and toggles off', () => {
    const on = prefixLines({ value: 'milk\n- eggs', start: 0, end: 11 }, '- [ ] ');
    expect(on.value).toBe('- [ ] milk\n- [ ] eggs');
    expect(prefixLines({ value: on.value, start: 0, end: on.value.length }, '- [ ] ').value).toBe('milk\neggs');
    expect(prefixLines({ value: 'a\nb', start: 0, end: 3 }, (i) => `${i + 1}. `).value).toBe('1. a\n2. b');
  });
  it('Enter continues a list and an empty item ends it', () => {
    expect(continueList({ value: '- [x] milk', start: 10, end: 10 })!.value).toBe('- [x] milk\n- [ ] ');
    expect(continueList({ value: '2. two', start: 6, end: 6 })!.value).toBe('2. two\n3. ');
    expect(continueList({ value: 'a\n- ', start: 4, end: 4 })!.value).toBe('a\n');
    expect(continueList({ value: 'plain', start: 5, end: 5 })).toBeNull();
  });
  it('a block lands on its own lines', () => {
    expect(insertBlock({ value: 'above\nbelow', start: 5, end: 5 }, 'X').value).toBe('above\n\nX\n\nbelow');
  });
});
