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

export function calculateClubExperienceYears(completedSessions: RegistrationContext['experience']['completedSessions']): number {
  const sessionsBySeason = new Map<string, number>();
  for (const session of completedSessions) {
    sessionsBySeason.set(session.seasonKey, (sessionsBySeason.get(session.seasonKey) ?? 0) + 1);
  }

  let years = 0;
  for (const completedSessionCount of sessionsBySeason.values()) {
    years += Math.min(1, completedSessionCount * 0.5);
  }
  return years;
}

export function effectiveExperienceYears(context: RegistrationContext): number {
  if (context.experience.type === 'specified_years') {
    return Math.max(0, context.experience.selfReportedYears ?? 0);
  }
  if (context.experience.type === 'known_existing') {
    return calculateClubExperienceYears(context.experience.completedSessions);
  }
  return 0;
}
