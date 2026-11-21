import { describe, expect, it } from 'vitest';
import { attPaths, imageMarkdown, isAudioPath, toggleTaskAt, voiceMarkdown } from '@/lib/note-media';

describe('note media', () => {
  it('voice clips are attachments told apart by their extension', () => {
    const md = voiceMarkdown('u1/voice-1.webm');
    expect(attPaths(md)).toEqual(['u1/voice-1.webm']);
    expect(isAudioPath('u1/voice-1.m4a')).toBe(true);
    expect(isAudioPath('u1/photo.webp')).toBe(false);
  });
  it('finds attached image paths, once each', () => {
    const body = `a\n${imageMarkdown('u1/x.webp', 'Cat')}\n![](https://e.com/y.png)\n${imageMarkdown('u1/x.webp')}`;
    expect(attPaths(body)).toEqual(['u1/x.webp']);
  });
  it('ticks and unticks the task that starts at an offset', () => {
    const body = 'Todo\n\n- [ ] milk\n- [x] eggs\n';
    const at = body.indexOf('- [ ] milk');
    const ticked = toggleTaskAt(body, at)!;
    expect(ticked).toContain('- [x] milk');
    expect(toggleTaskAt(ticked, at)).toBe(body);
    expect(toggleTaskAt(body, body.indexOf('- [x] eggs'))).toContain('- [ ] eggs');
    expect(toggleTaskAt(body, 0)).toBeNull();
  });
});

describe('live blocks and export', () => {
  it('finds chart and board blocks once each, and ignores ordinary code', async () => {
    const { embedBlocks, embedKey, noteMarkdown } = await import('@/lib/note-media');
    const body = 'Intro\n\n```chart\n{"type":"bar"}\n```\n\n```board\nmoney/spend\n```\n\n```js\nlet a = 1\n```\n\n```board\nmoney/spend\n```\n';
    expect(embedBlocks(body)).toEqual([
      { lang: 'chart', code: '{"type":"bar"}', key: embedKey('chart', '{"type":"bar"}\n') },
      { lang: 'board', code: 'money/spend', key: 'board:money/spend' },
    ]);
    expect(noteMarkdown({ title: 'Plan', body: 'Hello\n', tags: ['work'], updated_at: '2026-11-11T04:00:00Z', by: 'Claude' })).toBe('# Plan\n\n_Tags: work · Edited 2026-11-11 by Claude_\n\nHello\n');
  });
});
