import { describe, expect, it } from 'vitest';
import { safeNext } from '@/lib/redirect';

const O = 'https://www.slates.space';

describe('safeNext', () => {
  it('keeps same-origin paths', () => {
    expect(safeNext('/s/today', O)).toBe('/s/today');
    expect(safeNext('/agents?x=1#y', O)).toBe('/agents?x=1#y');
  });
  it.each([
    null,
    '',
    'https://evil.com',
    '//evil.com',
    '/\\evil.com',
    '/\t/evil.com',
    '\\\\evil.com',
    '/%0a/evil.com'.replace('%0a', '\n'),
    'javascript:alert(1)',
  ])('rejects %j', (v) => {
    expect(safeNext(v as string | null, O)).toBe('/home');
  });
});
