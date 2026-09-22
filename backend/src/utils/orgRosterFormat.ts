import { ageInYearsOnDate } from './memberAge.js';
import { USA_CURLING_CLUB_VALUE, USA_CURLING_YOUTH_MAX_AGE } from './parentOrganizations.js';

export type UsaCurlingMembershipType = 'Basic' | 'Youth';

export type UsaCurlingRosterRow = {
  email: string;
  firstName: string;
  lastName: string;
  gender: string;
  dateOfBirth: string | null;
  membershipNumber: string | null;
  validFrom: string;
  membershipType: UsaCurlingMembershipType;
  fromAnotherClub: boolean;
};

export type UswcaRosterRow = {
  lastName: string;
  firstName: string;
  email: string;
};

export function formatUsaSpreadsheetDate(isoDate: string | null | undefined): string {
  const value = isoDate?.trim() ?? '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return '';
  return `${match[2]}/${match[3]}/${match[1]}`;
}

export function usaCurlingMembershipType(input: {
  membershipType: 'regular' | 'social' | 'junior_recreational' | null;
  dateOfBirth: string | null;
  asOfDate: string;
}): UsaCurlingMembershipType {
  if (input.membershipType === 'junior_recreational') return 'Youth';
  const age = ageInYearsOnDate(input.dateOfBirth, input.asOfDate);
  if (age != null && age <= USA_CURLING_YOUTH_MAX_AGE) return 'Youth';
  return 'Basic';
}

export function usaCurlingFromAnotherClub(otherClubExperienceYears: number | null | undefined): boolean {
  return (otherClubExperienceYears ?? 0) > 0;
}

export function tsvCell(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value);
  if (/[\t\n\r"]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildUsaCurlingRosterTsv(rows: UsaCurlingRosterRow[]): string {
  return rows
    .map((row) =>
      [
        tsvCell(row.email),
        tsvCell(row.firstName),
        tsvCell(row.lastName),
        tsvCell(row.gender),
        tsvCell(formatUsaSpreadsheetDate(row.dateOfBirth)),
        tsvCell(row.membershipNumber),
        tsvCell(formatUsaSpreadsheetDate(row.validFrom)),
        tsvCell(USA_CURLING_CLUB_VALUE),
        tsvCell(row.membershipType),
        '',
        '',
        tsvCell(row.fromAnotherClub ? 'Yes' : 'No'),
      ].join('\t'),
    )
    .join('\n');
}

export function buildUswcaRosterTsv(rows: UswcaRosterRow[]): string {
  return rows
    .map((row) => [tsvCell(row.lastName), tsvCell(row.firstName), tsvCell(row.email)].join('\t'))
    .join('\n');
}
