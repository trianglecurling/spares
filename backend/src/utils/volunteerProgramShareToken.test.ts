import { describe, expect, test } from 'bun:test';
import {
  generateVolunteerProgramShareToken,
  volunteerProgramShareTokensMatch,
} from './volunteerProgramShareToken.js';

describe('volunteerProgramShareTokensMatch', () => {
  test('accepts only the exact token', () => {
    const token = generateVolunteerProgramShareToken();
    expect(token).toHaveLength(64);
    expect(volunteerProgramShareTokensMatch(token, token)).toBe(true);
    expect(volunteerProgramShareTokensMatch(token, `${token.slice(0, -1)}a`)).toBe(false);
    expect(volunteerProgramShareTokensMatch(token, token.slice(0, -1))).toBe(false);
    expect(volunteerProgramShareTokensMatch(token, null)).toBe(false);
    expect(volunteerProgramShareTokensMatch(null, token)).toBe(false);
    expect(volunteerProgramShareTokensMatch('  ', '  ')).toBe(false);
  });
});
