import { isTuesdayEveningLeague } from '../waitlistTuesdayEveningBadges.js';
import type { LeagueCategory, RosterRebuildLeague } from './rosterRebuildTypes.js';

export const LEAGUE_CATEGORIES: readonly LeagueCategory[] = [
  'normal',
  'doubles',
  'junior_rec',
  'junior_adv',
  'tuesday_evening',
  'day_league',
  'instructional',
  'unresolved',
];

const NORMAL_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'Hump Day', pattern: /hump\s*day/i },
  { label: 'Sunday Morning', pattern: /sunday\s*morning/i },
  { label: 'Sunday Funday', pattern: /sunday\s*funday/i },
  { label: 'I Hate Mondays', pattern: /i\s*hate\s*mondays/i },
  { label: 'Monday Late League', pattern: /monday\s*late/i },
  { label: 'Mad Hatter', pattern: /mad\s*hatter/i },
  { label: 'Diva', pattern: /\bdiva\b/i },
  { label: 'Leaguey McLeagueface', pattern: /leaguey\s*mcleagueface/i },
  { label: 'Friday Evening', pattern: /friday\s*evening/i },
  { label: 'Saturday Evening', pattern: /saturday\s*evening/i },
];

export function isLeagueCategory(value: string): value is LeagueCategory {
  return (LEAGUE_CATEGORIES as readonly string[]).includes(value);
}

export function resolveLeagueCategoryFromName(input: {
  name: string;
  isPlayInBased?: boolean | number | null;
  isJuniorRecreational?: boolean | number | null;
  format?: string | null;
}): LeagueCategory {
  const name = input.name.trim();
  if (Number(input.isJuniorRecreational) === 1 || /junior\s+recreational/i.test(name)) {
    return 'junior_rec';
  }
  if (/junior\s+advanced/i.test(name)) return 'junior_adv';
  if (isTuesdayEveningLeague({ name, isPlayInBased: input.isPlayInBased })) return 'tuesday_evening';
  if (/saturday/i.test(name) && /instructional/i.test(name)) return 'instructional';
  if (input.format === 'instructional' && /saturday/i.test(name)) return 'instructional';
  if (/early\s+doubles/i.test(name) || /late\s+doubles/i.test(name)) return 'doubles';
  if (/tuesday\s+day/i.test(name) || /wednesday\s+day/i.test(name)) return 'day_league';
  if (NORMAL_PATTERNS.some((entry) => entry.pattern.test(name))) return 'normal';
  return 'unresolved';
}

export type LeagueCategoryOverrideMap = Record<string, LeagueCategory>;

export function parseLeagueCategoryMapJson(raw: unknown): LeagueCategoryOverrideMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('League map must be a JSON object of league id or name → category.');
  }
  const source =
    'leagues' in raw && raw.leagues && typeof raw.leagues === 'object' && !Array.isArray(raw.leagues)
      ? (raw.leagues as Record<string, unknown>)
      : (raw as Record<string, unknown>);
  const out: LeagueCategoryOverrideMap = {};
  for (const [key, value] of Object.entries(source)) {
    const trimmed = key.trim();
    if (!trimmed) continue;
    if (typeof value !== 'string' || !isLeagueCategory(value)) {
      throw new Error(`League map "${trimmed}" must be a category, got: ${String(value)}`);
    }
    out[trimmed] = value;
  }
  return out;
}

export function applyLeagueCategoryOverrides(
  leagues: RosterRebuildLeague[],
  overrides: LeagueCategoryOverrideMap,
): RosterRebuildLeague[] {
  const byId = new Map<string, LeagueCategory>();
  const byName = new Map<string, LeagueCategory>();
  for (const [key, category] of Object.entries(overrides)) {
    if (/^\d+$/.test(key)) byId.set(key, category);
    else byName.set(key.trim().toLowerCase(), category);
  }
  return leagues.map((league) => {
    const fromId = byId.get(String(league.id));
    const fromName = byName.get(league.name.trim().toLowerCase());
    const category = fromId ?? fromName ?? league.category;
    return category === league.category ? league : { ...league, category };
  });
}

export function unresolvedLeagues(leagues: RosterRebuildLeague[]): RosterRebuildLeague[] {
  return leagues.filter((league) => league.category === 'unresolved');
}

export function leaguesInCategory(
  leagues: RosterRebuildLeague[],
  category: LeagueCategory,
): RosterRebuildLeague[] {
  return leagues.filter((league) => league.category === category);
}
