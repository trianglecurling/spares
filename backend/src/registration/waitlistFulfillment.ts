import { blockingError, type DecisionMessage } from './registrationDecisionTypes.js';
import type { RegistrationContext, RegistrationSelectionInput } from './registrationContext.js';

const SCHEDULED_FIRST_TWO_SELECTION_TYPES = new Set<RegistrationSelectionInput['selectionType']>([
  'guaranteed_return',
  'byot_request',
  'play_in_request',
]);

const ADD_WAITLIST_SELECTION_TYPES = new Set<RegistrationSelectionInput['selectionType']>([
  'waitlist_add',
  'waitlist_add_auto_decline',
]);

export function isAddWaitlistSelection(selection: RegistrationSelectionInput): boolean {
  return ADD_WAITLIST_SELECTION_TYPES.has(selection.selectionType);
}

export function addWaitlistSelections(context: RegistrationContext): RegistrationSelectionInput[] {
  return context.selections.filter((selection) => isAddWaitlistSelection(selection) && selection.leagueId != null);
}

export function selectedFirstTwoLeagueCount(context: RegistrationContext): number {
  return context.selections.filter((selection) =>
    SCHEDULED_FIRST_TWO_SELECTION_TYPES.has(selection.selectionType),
  ).length;
}

export function firstTwoLeagueSlotCount(context: RegistrationContext): number {
  return context.activeLeagueIds.length + selectedFirstTwoLeagueCount(context);
}

export function remainingFirstTwoSlots(context: RegistrationContext): number {
  return Math.max(0, 2 - firstTwoLeagueSlotCount(context));
}

export function maxDesiredAddWaitlistLeagueCount(context: RegistrationContext): number {
  return Math.min(remainingFirstTwoSlots(context), Math.max(1, addWaitlistSelections(context).length));
}

export function inferDefaultDesiredAddWaitlistLeagueCount(context: RegistrationContext): number | null {
  const addWaitlists = addWaitlistSelections(context);
  if (addWaitlists.length < 2) return null;
  const remaining = remainingFirstTwoSlots(context);
  if (remaining <= 0) return null;
  return Math.min(remaining, 2);
}

export function requiresWaitlistFulfillmentPreferences(context: RegistrationContext): boolean {
  return addWaitlistSelections(context).length >= 2;
}

export function applyAddWaitlistPriorityRanks(
  selections: RegistrationSelectionInput[],
  priorityLeagueIds: number[],
): RegistrationSelectionInput[] {
  const priorityIndexByLeagueId = new Map(priorityLeagueIds.map((leagueId, index) => [leagueId, index + 1] as const));
  return selections.map((selection) => {
    if (!isAddWaitlistSelection(selection) || selection.leagueId == null) return selection;
    const rank = priorityIndexByLeagueId.get(selection.leagueId);
    return rank != null ? { ...selection, rank } : selection;
  });
}

export function addWaitlistPriorityLeagueIds(context: RegistrationContext): number[] {
  return addWaitlistSelections(context)
    .slice()
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER))
    .map((selection) => selection.leagueId as number);
}

export function validateWaitlistFulfillment(
  context: RegistrationContext,
  desiredAddWaitlistLeagueCount: number | null | undefined,
): DecisionMessage[] {
  const blockingErrors: DecisionMessage[] = [];
  const addWaitlists = addWaitlistSelections(context);
  if (addWaitlists.length < 2) {
    if (desiredAddWaitlistLeagueCount != null) {
      blockingErrors.push(
        blockingError(
          'waitlist_fulfillment_not_applicable',
          'Waitlist fulfillment preferences are only required when joining multiple ADD waitlists.',
        ),
      );
    }
    return blockingErrors;
  }

  const remaining = remainingFirstTwoSlots(context);
  if (remaining <= 0) {
    blockingErrors.push(
      blockingError(
        'waitlist_fulfillment_no_remaining_slots',
        'ADD waitlist fulfillment preferences cannot be set when you already hold two leagues.',
      ),
    );
    return blockingErrors;
  }

  const maxDesired = maxDesiredAddWaitlistLeagueCount(context);
  if (desiredAddWaitlistLeagueCount == null) {
    blockingErrors.push(
      blockingError(
        'waitlist_fulfillment_count_required',
        'Choose how many leagues you want if multiple waitlist spots open.',
      ),
    );
    return blockingErrors;
  }

  if (!Number.isInteger(desiredAddWaitlistLeagueCount) || desiredAddWaitlistLeagueCount < 1 || desiredAddWaitlistLeagueCount > maxDesired) {
    blockingErrors.push(
      blockingError(
        'waitlist_fulfillment_count_invalid',
        `Choose between 1 and ${maxDesired} leagues from your waitlists.`,
      ),
    );
  }

  const ranks = addWaitlists.map((selection) => selection.rank).filter((rank): rank is number => rank != null);
  const uniqueRanks = new Set(ranks);
  if (ranks.length !== addWaitlists.length || uniqueRanks.size !== addWaitlists.length) {
    blockingErrors.push(
      blockingError(
        'waitlist_fulfillment_priority_required',
        'Rank each ADD waitlist in priority order.',
      ),
    );
  } else {
    const sortedRanks = [...uniqueRanks].sort((a, b) => a - b);
    const expectedRanks = addWaitlists.map((_, index) => index + 1);
    const contiguous = sortedRanks.every((rank, index) => rank === expectedRanks[index]);
    if (!contiguous) {
      blockingErrors.push(
        blockingError(
          'waitlist_fulfillment_priority_invalid',
          'Waitlist priority ranks must be unique and consecutive starting at 1.',
        ),
      );
    }
  }

  return blockingErrors;
}
