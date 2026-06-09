import type { CurlingExperienceTypeSqlite } from '../db/drizzle-schema.js';
import type { MemberExperienceBaselines } from './curlingExperienceYears.js';
import type { LeagueConfig, RegistrationContext } from './registrationContext.js';

const ISO_DATE_LENGTH = 10;

export function dateOnly(value: string): string {
  return value.slice(0, ISO_DATE_LENGTH);
}

export function addYears(date: string, years: number): string {
  const parsed = new Date(`${dateOnly(date)}T00:00:00.000Z`);
  parsed.setUTCFullYear(parsed.getUTCFullYear() + years);
  return parsed.toISOString().slice(0, ISO_DATE_LENGTH);
}

export function compareDateLike(a: string, b: string): number {
  return dateOnly(a).localeCompare(dateOnly(b));
}

export function ageOnDate(dateOfBirth: string, targetDate: string): number {
  const birth = dateOnly(dateOfBirth);
  const target = dateOnly(targetDate);
  let age = Number(target.slice(0, 4)) - Number(birth.slice(0, 4));
  if (target.slice(5) < birth.slice(5)) {
    age -= 1;
  }
  return age;
}

export const JUNIOR_RECREATIONAL_MAX_AGE = 21;

export function ageOnToday(dateOfBirth: string | null | undefined): number | null {
  if (!dateOfBirth) return null;
  const today = new Date().toISOString().slice(0, ISO_DATE_LENGTH);
  return ageOnDate(dateOfBirth, today);
}

export function isJuniorRecreationalEligible(dateOfBirth: string | null | undefined): boolean {
  const age = ageOnToday(dateOfBirth);
  return age !== null && age <= JUNIOR_RECREATIONAL_MAX_AGE;
}

export function leagueFirstDay(league: LeagueConfig): string {
  return league.firstDayOfPlay ?? league.startDate ?? '';
}

export function leagueLastDay(league: LeagueConfig): string {
  return league.lastDayOfPlay ?? league.endDate ?? leagueFirstDay(league);
}

export function ageOnLeagueStart(dateOfBirth: string | null | undefined, league: LeagueConfig): number | null {
  const firstDay = leagueFirstDay(league);
  if (!dateOfBirth || !firstDay) return null;
  return ageOnDate(dateOfBirth, firstDay);
}

export function calculateComputedClubExperienceYears(
  completedSessions: RegistrationContext['experience']['completedSessions']
): number {
  const sessionsBySeason = new Map<string, number>();
  for (const session of completedSessions) {
    sessionsBySeason.set(session.seasonKey, (sessionsBySeason.get(session.seasonKey) ?? 0) + 1);
  }

  let years = 0;
  for (const completedSessionCount of sessionsBySeason.values()) {
    years += Math.min(1, completedSessionCount);
  }
  return years;
}

/** @deprecated Use {@link calculateComputedClubExperienceYears}. */
export const calculateClubExperienceYears = calculateComputedClubExperienceYears;

export function totalExperienceYears(input: {
  experienceType: CurlingExperienceTypeSqlite;
  selfReportedYears?: number | null;
  baselines: MemberExperienceBaselines;
  completedSessions: RegistrationContext['experience']['completedSessions'];
}): number {
  const computedClubYears = calculateComputedClubExperienceYears(input.completedSessions);
  const baselineClubYears = Math.max(0, input.baselines.baselineClubExperienceYears);
  if (input.experienceType === 'specified_years') {
    const otherClubYears = Math.max(0, input.selfReportedYears ?? 0);
    return otherClubYears + baselineClubYears + computedClubYears;
  }
  const baselineOtherClubYears = Math.max(0, input.baselines.baselineOtherClubExperienceYears);
  return baselineOtherClubYears + baselineClubYears + computedClubYears;
}

export function effectiveExperienceYears(context: RegistrationContext): number {
  return totalExperienceYears({
    experienceType: context.experience.type,
    selfReportedYears: context.experience.selfReportedYears,
    baselines: {
      baselineOtherClubExperienceYears: context.experience.baselineOtherClubExperienceYears,
      baselineClubExperienceYears: context.experience.baselineClubExperienceYears,
    },
    completedSessions: context.experience.completedSessions,
  });
}

export function hasRecordedExperience(input: {
  experienceType: CurlingExperienceTypeSqlite;
  selfReportedYears?: number | null;
  baselines: MemberExperienceBaselines;
  completedSessions: RegistrationContext['experience']['completedSessions'];
}): boolean {
  if (input.experienceType === 'specified_years') {
    return (input.selfReportedYears ?? 0) > 0;
  }
  return totalExperienceYears(input) > 0;
}
