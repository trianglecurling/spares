import type {
  LeagueEntryPointsRow,
  LeagueEntryTeamRow,
  PlayInEvaluationConfig,
  PlayInLeagueConfigRow,
  PlayInLeagueEvaluation,
  PlayInMemberPoints,
  PlayInTeamForEvaluation,
} from './playInEntryService.js';

const MAX_EVALUATION_CACHE_ENTRIES = 48;

type EvaluationCacheEntry = PlayInLeagueEvaluation;

const evaluationCache = new Map<string, EvaluationCacheEntry>();
const sourceCache = new Map<number, PlayInLeagueSourceSnapshot>();

export type PlayInLeagueSourceSnapshot = {
  league: PlayInLeagueConfigRow;
  points: LeagueEntryPointsRow[];
  teams: LeagueEntryTeamRow[];
};

export function playInEvaluationFingerprint(
  config: PlayInEvaluationConfig & { playInSpotCount: number },
  points: PlayInMemberPoints[],
  teams: PlayInTeamForEvaluation[]
): string {
  const pointParts = [...points]
    .sort((left, right) => left.memberId - right.memberId)
    .map(
      (entry) =>
        `${entry.memberId}:${entry.pointsHalf}:${entry.countsAsReturning ? 1 : 0}`
    );
  const teamParts = teams
    .map((team) => {
      const memberIds = [...team.memberIds].sort((left, right) => left - right).join(',');
      return `${team.entryTeamId ?? 'draft'}:${team.status}:${team.pendingNameCount}:${memberIds}`;
    })
    .sort();
  return [
    config.autoEntryCount,
    config.teamSize,
    config.playInSpotCount,
    pointParts.join(';'),
    teamParts.join(';'),
  ].join('|');
}

export function getCachedPlayInEvaluation(key: string): PlayInLeagueEvaluation | undefined {
  const hit = evaluationCache.get(key);
  if (!hit) return undefined;
  evaluationCache.delete(key);
  evaluationCache.set(key, hit);
  return structuredClone(hit);
}

export function setCachedPlayInEvaluation(key: string, value: PlayInLeagueEvaluation): void {
  evaluationCache.delete(key);
  evaluationCache.set(key, structuredClone(value));
  while (evaluationCache.size > MAX_EVALUATION_CACHE_ENTRIES) {
    const oldest = evaluationCache.keys().next().value;
    if (oldest == null) break;
    evaluationCache.delete(oldest);
  }
}

export function getCachedPlayInSource(leagueId: number): PlayInLeagueSourceSnapshot | undefined {
  const hit = sourceCache.get(leagueId);
  if (!hit) return undefined;
  return structuredClone(hit);
}

export function setCachedPlayInSource(leagueId: number, snapshot: PlayInLeagueSourceSnapshot): void {
  sourceCache.set(leagueId, structuredClone(snapshot));
}

/**
 * Drop cached TLINE evaluations and loaded league snapshots.
 * Pass a league id after that league's points, declared teams, or play-in config change.
 * Omit it to clear every league (registration sync that may touch several play-in leagues).
 */
export function invalidatePlayInEvaluationCache(leagueId?: number): void {
  evaluationCache.clear();
  if (leagueId == null) {
    sourceCache.clear();
    return;
  }
  sourceCache.delete(leagueId);
}
