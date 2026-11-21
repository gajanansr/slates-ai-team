/** "₹1,00,000", "64K", "7.6h", "-€3.2", "52%": a value that is one number (with currency/unit). */
export const isNumberish = (v: string) => /^[-+−]?[^\d\s]{0,3}\s?\d[\d.,]*[A-Za-z%]{0,3}$/.test(v.trim());

/**
 * Font size for a big number so it fits its card without being cut or wrapped mid-number:
 * full size up to 6 characters, then a step smaller as it gets longer.
 */
export function fitNumber(v: string, base: number): number {
  const n = v.trim().length;
  return n <= 6 ? base : n <= 8 ? base - 2 : n <= 10 ? base - 4 : n <= 13 ? base - 7 : base - 9;
}
