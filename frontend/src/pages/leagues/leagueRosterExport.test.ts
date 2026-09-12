import { describe, expect, test } from 'bun:test';
import {
  buildLeagueRosterTsv,
  formatRosterClubTenure,
  formatRosterPreviousLeagues,
  formatRosterYears,
  previousSessionLeaguesColumnLabel,
} from './leagueRosterExport';

describe('league roster export', () => {
  test('formats years, tenure, and previous leagues', () => {
    expect(formatRosterYears(8)).toBe('8');
    expect(formatRosterYears(5.5)).toBe('5.5');
    expect(formatRosterYears(null)).toBe('—');
    expect(formatRosterClubTenure({ kind: 'new', years: null })).toBe('New');
    expect(formatRosterClubTenure({ kind: 'years', years: 4 })).toBe('4');
    expect(formatRosterPreviousLeagues(['Monday Night', 'Tuesday Evening'])).toBe(
      'Monday Night, Tuesday Evening',
    );
    expect(previousSessionLeaguesColumnLabel('Fall 2025')).toBe('Fall 2025 leagues');
  });

  test('builds a TSV with manager insight columns', () => {
    const tsv = buildLeagueRosterTsv([
      {
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        assignedTeamName: 'Team Lovelace',
        totalExperienceYears: 12,
        clubTenure: { kind: 'years', years: 8 },
        previousSessionName: 'Fall 2025',
        previousSessionLeagues: ['Monday Night'],
      },
    ]);

    expect(tsv).toContain('Fall 2025 leagues');
    expect(tsv).toContain('Ada Lovelace\tada@example.com\tTeam Lovelace\t12\t8\tMonday Night');
  });
});
