import { describe, expect, test } from 'bun:test';
import { toAllowsDropIns } from './leagueDropIn.js';

describe('leagueDropIn helpers', () => {
  test('toAllowsDropIns treats 1 and true as enabled', () => {
    expect(toAllowsDropIns(1)).toBe(true);
    expect(toAllowsDropIns(true)).toBe(true);
  });

  test('toAllowsDropIns treats 0, false, null, and undefined as disabled', () => {
    expect(toAllowsDropIns(0)).toBe(false);
    expect(toAllowsDropIns(false)).toBe(false);
    expect(toAllowsDropIns(null)).toBe(false);
    expect(toAllowsDropIns(undefined)).toBe(false);
  });
});
