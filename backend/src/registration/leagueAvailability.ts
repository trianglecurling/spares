import type { LeagueConfig } from './registrationContext.js';
import { loadActiveWaitlistEntryCountsByLeagueId } from './waitlistEntityService.js';
import { loadLeagueVacancyCountsByLeagueId } from './waitlistStaffService.js';

/**
 * Attaches live waitlist length and remaining spots so priority labels and
 * checkout use the same vacancy picture as the catalog.
 */
export async function attachLiveLeagueAvailability(leagues: LeagueConfig[]): Promise<LeagueConfig[]> {
  if (leagues.length === 0) return leagues;
  const [waitlistCounts, vacancyCounts] = await Promise.all([
    loadActiveWaitlistEntryCountsByLeagueId(leagues.map((league) => league.id)),
    loadLeagueVacancyCountsByLeagueId(leagues),
  ]);
  return leagues.map((league) => {
    const vacancies = vacancyCounts.get(league.id);
    return {
      ...league,
      activeWaitlistEntryCount: league.waitlistId != null ? (waitlistCounts.get(league.id) ?? 0) : 0,
      openSpotCount: vacancies?.permanentVacancies ?? 0,
      temporarySabbaticalFillVacancyCount: vacancies?.temporarySabbaticalFillVacancies ?? 0,
    };
  });
}
