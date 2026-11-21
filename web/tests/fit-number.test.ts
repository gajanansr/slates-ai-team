import { describe, expect, it } from 'vitest';
import { fitNumber, isNumberish } from '@/lib/fit-number';

describe('fitNumber', () => {
  it('recognises numbers with currency and units, not words', () => {
    for (const v of ['₹1,00,000', '64K', '7.6h', '52%', '€104', '-₹3,200', '12,34,56,789']) expect(isNumberish(v), v).toBe(true);
    for (const v of ['Shipped v2', '3 Nov', 'In review']) expect(isNumberish(v), v).toBe(false);
  });
  it('shrinks long numbers step by step', () => {
    expect(fitNumber('52', 22)).toBe(22);
    expect(fitNumber('₹1,00,000', 22)).toBe(18);
    expect(fitNumber('₹12,34,56,789', 22)).toBe(15);
  });
});
