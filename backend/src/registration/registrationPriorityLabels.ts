/**
 * Shared guarantee-label evaluation used by staff QA and the league roster
 * page. Builds `labelPriorityEntries` candidates from stored priorities plus
 * return rights; labels themselves are never stored.
 */
import {
  labelPriorityEntries,
  priorityRosterAllReturning,
  priorityRosterIsComplete,
  type LeaguePriorityGuaranteeLabel,
  type PriorityLabelCandidate,
  type PriorityLabelMode,
  type PriorityLeagueShape,
} from './leaguePriorityRules.js';
import type { LeaguePriorityInput } from './registrationContext.js';

export const ACTIVE_SABBATICAL_STATUSES = ['active', 'staff_overridden', 'returning'] as const;

export type GuaranteeLabelLeagueRow = {
  id: number;
  predecessorLeagueId: number | null;
  league: PriorityLeagueShape;
};

export type EvaluateGuaranteeLabelsInput = {
  priorities: LeaguePriorityInput[];
  desiredLeagueCount: number | null;
  mode: PriorityLabelMode;
  memberId: number;
  isReturningMember: boolean;
  participatedLeagueIds: ReadonlySet<number>;
  sabbaticals: Array<{ originalLeagueId: number | null; currentLeagueId: number | null; status: string }>;
  leaguesById: Map<number, GuaranteeLabelLeagueRow>;
  returnEligibleMemberIdsByLeagueId: ReadonlyMap<number, ReadonlySet<number>>;
};

export type RosterRegistrationStatus = {
  guaranteeLabel: LeaguePriorityGuaranteeLabel;
  priorityRank: number;
};

export function asPriorityLeague(row: {
  league_type: 'standard' | 'bring_your_own_team';
  format: 'teams' | 'doubles' | 'instructional';
  waitlist_id: number | null;
  is_play_in_based: number | boolean | null;
  registration_fee_minor: number | null;
}): PriorityLeagueShape {
  return {
    leagueType: row.league_type,
    format: row.format,
    allowsWaitlist: row.waitlist_id != null,
    isPlayInBased: row.is_play_in_based === 1 || row.is_play_in_based === true,
    registrationFeeMinor: row.registration_fee_minor ?? 0,
  };
}

export function sabbaticalMatchesLeague(input: {
  originalLeagueId: number | null;
  currentLeagueId: number | null;
  predecessorLeagueId: number | null;
  leagueId: number;
}): boolean {
  return (
    input.currentLeagueId === input.predecessorLeagueId ||
    input.originalLeagueId === input.predecessorLeagueId ||
    input.currentLeagueId === input.leagueId ||
    input.originalLeagueId === input.leagueId
  );
}

export function evaluateGuaranteeLabels(
  input: EvaluateGuaranteeLabelsInput,
): Map<number, LeaguePriorityGuaranteeLabel> {
  const candidates: PriorityLabelCandidate[] = [...input.priorities]
    .sort((a, b) => a.priorityRank - b.priorityRank)
    .flatMap((priority) => {
      const leagueRow = input.leaguesById.get(priority.leagueId);
      if (!leagueRow) return [];
      const predecessorId = leagueRow.predecessorLeagueId;
      const sabbaticalRight = input.sabbaticals.some(
        (sabbatical) =>
          (ACTIVE_SABBATICAL_STATUSES as readonly string[]).includes(sabbatical.status) &&
          sabbaticalMatchesLeague({
            originalLeagueId: sabbatical.originalLeagueId,
            currentLeagueId: sabbatical.currentLeagueId,
            predecessorLeagueId: predecessorId,
            leagueId: leagueRow.id,
          }),
      );
      const hasReturnRight =
        input.mode === 'priority' &&
        input.isReturningMember &&
        predecessorId != null &&
        (input.participatedLeagueIds.has(predecessorId) || sabbaticalRight);
      const returnEligible = new Set(input.returnEligibleMemberIdsByLeagueId.get(priority.leagueId) ?? []);
      if (hasReturnRight) returnEligible.add(input.memberId);
      return [
        {
          leagueId: priority.leagueId,
          priorityRank: priority.priorityRank,
          hasReturnRight,
          rosterComplete: priorityRosterIsComplete(leagueRow.league, priority, input.memberId),
          rosterAllReturning: priorityRosterAllReturning(leagueRow.league, priority, returnEligible, input.memberId),
          feeMinor: leagueRow.league.registrationFeeMinor,
          allowsWaitlist: leagueRow.league.allowsWaitlist,
          isPlayInBased: leagueRow.league.isPlayInBased === true,
          isInstructional: leagueRow.league.format === 'instructional',
        },
      ];
    });

  const evaluation = labelPriorityEntries({
    candidates,
    desiredLeagueCount: input.desiredLeagueCount,
    mode: input.mode,
  });
  return new Map(evaluation.entries.map((entry) => [entry.leagueId, entry.label]));
}

/** Status for one league on a registrant's list, or null when that league is not listed. */
export function rosterStatusForLeague(
  leagueId: number,
  priorities: Array<{ leagueId: number; priorityRank: number }>,
  labels: ReadonlyMap<number, LeaguePriorityGuaranteeLabel>,
): RosterRegistrationStatus | null {
  const priority = priorities.find((entry) => entry.leagueId === leagueId);
  if (!priority) return null;
  const guaranteeLabel = labels.get(leagueId);
  if (guaranteeLabel == null) return null;
  return { guaranteeLabel, priorityRank: priority.priorityRank };
}
