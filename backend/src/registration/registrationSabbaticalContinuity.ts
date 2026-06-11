import { canExtendSabbaticalIntoLeague } from './sabbaticalDurationLimit.js';
import { blockingError, type DecisionMessage } from './registrationDecisionTypes.js';
import type { ExistingSabbatical, LeagueConfig, RegistrationContext } from './registrationContext.js';
import { findRelevantSabbatical } from './registrationReturningRights.js';

export type ContinuingSabbaticalSummary = {
  sabbaticalId: number;
  leagueId: number;
  leagueName: string;
  priorLeagueId: number;
  firstSabbaticalStartDate: string;
  canExtend: boolean;
  extensionBlockedMessage: string | null;
  sabbaticalFeeMinor: number;
};

const PRIOR_SESSION_DECISION_TYPES = new Set([
  'guaranteed_return',
  'sabbatical',
  'drop',
  'return_subject_to_availability',
]);

export function isActiveSabbaticalRecord(sabbatical: ExistingSabbatical): boolean {
  return sabbatical.status === 'active' || sabbatical.status === 'staff_overridden' || sabbatical.status === 'returning';
}

export function leagueRequiresPriorSessionDecision(
  context: RegistrationContext,
  league: LeagueConfig,
): boolean {
  if (context.registrationState !== 'priority') return false;
  const playedPredecessor =
    league.predecessorLeagueId != null && context.participatedLeagueIds.includes(league.predecessorLeagueId);
  const continuingSabbatical = findRelevantSabbatical(context, league) !== undefined;
  return playedPredecessor || continuingSabbatical;
}

export function listLeaguesRequiringPriorSessionDecision(context: RegistrationContext): LeagueConfig[] {
  return Object.values(context.leagues).filter((league) => leagueRequiresPriorSessionDecision(context, league));
}

export function listContinuingSabbaticalSummaries(context: RegistrationContext): ContinuingSabbaticalSummary[] {
  if (context.registrationState !== 'priority') return [];

  const summaries: ContinuingSabbaticalSummary[] = [];
  for (const league of Object.values(context.leagues)) {
    const sabbatical = findRelevantSabbatical(context, league);
    if (!sabbatical) continue;

    const playedPredecessor =
      league.predecessorLeagueId != null && context.participatedLeagueIds.includes(league.predecessorLeagueId);
    if (playedPredecessor) continue;

    const durationCheck = canExtendSabbaticalIntoLeague({
      sabbatical,
      league,
      durationLimitYears: context.sabbaticalDurationLimitYears,
      staffOverrideSabbaticalDuration: context.staffOverrideSabbaticalDuration,
    });

    summaries.push({
      sabbaticalId: sabbatical.id,
      leagueId: league.id,
      leagueName: league.name,
      priorLeagueId: sabbatical.currentLeagueId,
      firstSabbaticalStartDate: sabbatical.firstSabbaticalStartDate,
      canExtend: durationCheck.allowed,
      extensionBlockedMessage: durationCheck.allowed
        ? null
        : durationCheck.blockedMessage ?? 'The configured sabbatical duration limit has been reached for this league.',
      sabbaticalFeeMinor: context.priceConfig.sabbaticalFeeMinor,
    });
  }

  return summaries.sort((a, b) => a.leagueName.localeCompare(b.leagueName));
}

export function validateContinuingSabbaticalDecisions(context: RegistrationContext): DecisionMessage[] {
  const blockingErrors: DecisionMessage[] = [];
  for (const summary of listContinuingSabbaticalSummaries(context)) {
    const decision = context.selections.find(
      (selection) =>
        selection.leagueId === summary.leagueId &&
        PRIOR_SESSION_DECISION_TYPES.has(selection.selectionType),
    );
    if (!decision) {
      blockingErrors.push(
        blockingError(
          'continuing_sabbatical_decision_required',
          `Choose whether to return, extend sabbatical, or drop ${summary.leagueName} before continuing.`,
        ),
      );
      continue;
    }

    if (decision.selectionType === 'sabbatical' && !summary.canExtend) {
      blockingErrors.push(
        blockingError(
          'sabbatical_duration_limit_exceeded',
          summary.extensionBlockedMessage ?? 'Sabbatical duration limit has been reached.',
        ),
      );
    }
  }
  return blockingErrors;
}

export function sabbaticalMatchesLeagueLineage(
  sabbatical: Pick<ExistingSabbatical, 'currentLeagueId' | 'originalLeagueId'>,
  league: Pick<LeagueConfig, 'id' | 'predecessorLeagueId'>,
): boolean {
  return (
    sabbatical.currentLeagueId === league.predecessorLeagueId ||
    sabbatical.originalLeagueId === league.predecessorLeagueId ||
    sabbatical.currentLeagueId === league.id ||
    sabbatical.originalLeagueId === league.id
  );
}
