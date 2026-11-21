import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { remarkGfmSafe } from '@/lib/markdown';

describe('safe GFM markdown', () => {
  it('renders tables, strikethrough and tasks', () => {
    const html = renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkGfmSafe] }, '| a | b |\n|---|---|\n| 1 | 2 |\n\n~~old~~\n\n- [x] done\n\nmail me@x.com'));
    expect(html).toContain('<table>');
    expect(html).toContain('<del>old</del>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('me@x.com');
  });
});
