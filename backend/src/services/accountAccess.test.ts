import { describe, expect, test } from 'bun:test';
import { isMemberMinor } from '../utils/memberAge.js';

describe('isMemberMinor', () => {
  test('returns true for members under 18', () => {
    const today = new Date();
    const minorYear = today.getUTCFullYear() - 10;
    const month = String(today.getUTCMonth() + 1).padStart(2, '0');
    const day = String(today.getUTCDate()).padStart(2, '0');
    expect(isMemberMinor(`${minorYear}-${month}-${day}`)).toBe(true);
  });

  test('returns false for members 18 or older', () => {
    const today = new Date();
    const adultYear = today.getUTCFullYear() - 25;
    const month = String(today.getUTCMonth() + 1).padStart(2, '0');
    const day = String(today.getUTCDate()).padStart(2, '0');
    expect(isMemberMinor(`${adultYear}-${month}-${day}`)).toBe(false);
  });
});
