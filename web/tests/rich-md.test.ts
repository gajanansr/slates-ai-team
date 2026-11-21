import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from '@/lib/rich-md';

/** A tiny stand-in for DOM nodes, enough for the serializer. */
type N = { nodeType: number; nodeName: string; textContent: string; childNodes: N[]; getAttribute: (n: string) => string | null };
const t = (text: string): N => ({ nodeType: 3, nodeName: '#text', textContent: text, childNodes: [], getAttribute: () => null });
const el = (name: string, kids: (N | string)[] = [], attrs: Record<string, string> = {}): N => {
  const childNodes = kids.map((k) => (typeof k === 'string' ? t(k) : k));
  return { nodeType: 1, nodeName: name.toUpperCase(), childNodes, textContent: childNodes.map((c) => c.textContent).join(''), getAttribute: (n) => attrs[n] ?? null };
};

describe('rich editor -> Markdown', () => {
  it('writes headings, bold, italic and links the way agents write them', () => {
    const root = el('div', [el('h2', ['Plan']), el('p', ['Buy ', el('b', ['milk ']), 'and ', el('em', ['eggs']), ' at ', el('a', ['the shop'], { href: 'https://shop.example' })])]);
    expect(htmlToMarkdown(root)).toBe('## Plan\n\nBuy **milk** and _eggs_ at [the shop](https://shop.example)');
  });
  it('writes checklists, numbered and nested lists', () => {
    const root = el('div', [
      el('ul', [el('li', ['milk'], { 'data-checked': 'true' }), el('li', ['eggs'], { 'data-checked': 'false' })], { 'data-task': '1' }),
      el('ol', [el('li', ['one', el('ul', [el('li', ['inner'])])]), el('li', ['two'])]),
    ]);
    expect(htmlToMarkdown(root)).toBe('- [x] milk\n- [ ] eggs\n\n1. one\n  - inner\n2. two');
  });
  it('carries charts, photos and quotes through untouched, and drops empty paragraphs', () => {
    const chart = '```chart\n{"type":"bar"}\n```';
    const root = el('div', [el('p', [el('br')]), el('div', ['Chart'], { 'data-md': chart, 'data-block': '1' }), el('p', [el('span', ['Photo'], { 'data-md': '![](att:u/x.webp)' })]), el('blockquote', [el('p', ['wise'])]), 'loose text']);
    expect(htmlToMarkdown(root)).toBe(`${chart}\n\n![](att:u/x.webp)\n\n> wise\n\nloose text`);
  });
});
