import { describe, expect, it } from 'bun:test';
import { sparePositionFromTeamMember } from './sparePositionFromTeamMember.js';

describe('sparePositionFromTeamMember', () => {
  it('prefers skip/vice flags over role', () => {
    expect(sparePositionFromTeamMember({ role: 'lead', isSkip: true })).toBe('skip');
    expect(sparePositionFromTeamMember({ role: 'second', isVice: true })).toBe('vice');
  });

  it('maps standard team roles', () => {
    expect(sparePositionFromTeamMember({ role: 'lead' })).toBe('lead');
    expect(sparePositionFromTeamMember({ role: 'second' })).toBe('second');
    expect(sparePositionFromTeamMember({ role: 'third' })).toBe('vice');
    expect(sparePositionFromTeamMember({ role: 'fourth' })).toBe('skip');
  });

  it('returns null for doubles roles', () => {
    expect(sparePositionFromTeamMember({ role: 'player1' })).toBeNull();
    expect(sparePositionFromTeamMember({ role: 'player2' })).toBeNull();
  });
});
