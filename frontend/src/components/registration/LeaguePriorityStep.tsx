import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { HiChevronDown, HiChevronUp } from 'react-icons/hi2';
import Button from '../Button';
import ChoiceInput from '../ChoiceInput';
import ConfirmDialog from '../ConfirmDialog';
import FormCheckbox from '../FormCheckbox';
import FormField from '../FormField';
import FormFieldMessage from '../FormFieldMessage';
import InlineStateMessage from '../InlineStateMessage';
import PublicStateCard from '../PublicStateCard';
import SortableList from '../dragDrop/SortableList';
import PriorityRosterField from './PriorityRosterField';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useMemberOptions } from '../../contexts/MemberOptionsContext';
import api from '../../utils/api';
import {
  addPriority,
  availableLeaguesToAdd,
  canMovePriority,
  countPriorityRoster,
  evaluatePriorityList,
  defaultDesiredLeagueCount,
  expectedByotRosterSize,
  filterPrioritiesToAllowedLeagues,
  guaranteeChipClassName,
  guaranteeChipLabel,
  shouldShowGuaranteeChip,
  hydratePriorityList,
  incompletePlayInLeagueNames,
  seedableWaitlistLeagueIds,
  immediateChargeEntries,
  isFreeLeague,
  mergeNewlyJoinedWaitlistLeagues,
  MAX_DESIRED_LEAGUE_COUNT,
  MIN_PLAY_IN_ROSTER_SIZE,
  canReorderPriorityDrop,
  movePriorityInList,
  omittedWaitlistLeagues,
  formatConjunctionList,
  paidPriorLeaguesOffList,
  removePriority,
  reorderPriorities,
  sabbaticalListEntries,
  undecidedContinuingSabbaticalIds,
  undecidedPriorLeagueIds,
  updatePriorityRoster,
  priorityMoveButtonTitle,
  addPriorityAtTop,
  type LeaguePriorityInput,
  type LeaguePrioritySavePayload,
  type PriorLeagueDecision,
  type RegistrationLeagueCatalogPayload,
} from './leaguePriorityShared';
import {
  formatCurrency,
  isLeagueSelectionEligibleLeague,
  leagueScheduleText,
  type LeagueCatalogItem,
  type LeagueEligibilityInput,
  type RegistrationPlayInEntrySummary,
} from './registrationViewEditShared';

type Props = {
  payload: RegistrationLeagueCatalogPayload | null;
  eligibility: LeagueEligibilityInput;
  registeringCurler: { id: number | null; name: string };
  saving: boolean;
  continueLabel: string;
  /** Basic ice privileges: only free leagues may be listed or added. */
  restrictToFreeLeagues?: boolean;
  onSave: (input: LeaguePrioritySavePayload) => Promise<void>;
};

type RemovalPrompt = {
  league: LeagueCatalogItem;
  decision: 'sabbatical' | 'drop' | null;
};

function leagueRowSubtitle(league: LeagueCatalogItem): string {
  const schedule = leagueScheduleText(league);
  return [schedule, formatCurrency(league.registrationFeeMinor)].filter(Boolean).join(' · ');
}

function omittedWaitlistNotice(leagues: LeagueCatalogItem[]) {
  const names = formatConjunctionList(leagues.map((league) => league.name));
  const plural = leagues.length !== 1;
  const pronoun = plural ? 'them' : 'it';
  const leagueNoun = plural ? 'these leagues' : 'this league';
  return (
    <>
      Notice: you are currently on the waitlist for {names}, but you have not included {pronoun} in your priority list
      above. If your spot comes available in this session, it will be <strong>automatically declined</strong>. If you
      are still interested in joining {leagueNoun}, include {pronoun} in your prioritized list above.
    </>
  );
}

/**
 * The single page where a registrant says how many leagues they want and ranks
 * the leagues they want them to be. Guarantee chips are computed locally with
 * the same module the server uses, so they update as the list is reordered
 * without a round trip.
 */
export default function LeaguePriorityStep({
  payload,
  eligibility,
  registeringCurler,
  saving,
  continueLabel,
  restrictToFreeLeagues = false,
  onSave,
}: Props) {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const memberOptions = useMemberOptions({ autoLoad: true });
  const countInputId = useId();
  const addLeagueInputId = useId();
  const listLabelId = useId();
  const sabbaticalsLabelId = useId();
  const paidReturnLabelId = useId();
  const restrictHydratedRef = useRef(restrictToFreeLeagues);

  const [priorities, setPriorities] = useState<LeaguePriorityInput[]>([]);
  const [desiredLeagueCount, setDesiredLeagueCount] = useState<number | null>(null);
  const [priorLeagueDecisions, setPriorLeagueDecisions] = useState<PriorLeagueDecision[]>([]);
  const [basicIceFallbackInterest, setBasicIceFallbackInterest] = useState<boolean>(false);
  const [removalPrompt, setRemovalPrompt] = useState<RemovalPrompt | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [playInEntry, setPlayInEntry] = useState<Record<number, RegistrantPlayInEntrySummaryLike>>({});
  const hydratedRef = useRef(false);
  const knownWaitlistLeagueIdsRef = useRef<Set<number>>(new Set());

  const leagues = useMemo(() => payload?.leagues ?? [], [payload]);
  const leagueById = useMemo(
    () => new Map(leagues.map((league) => [league.id, league])),
    [leagues],
  );

  useEffect(() => {
    if (!payload) return;
    const turnedOnFreeOnly = restrictToFreeLeagues && !restrictHydratedRef.current;
    restrictHydratedRef.current = restrictToFreeLeagues;
    const currentWaitlistIds = new Set(seedableWaitlistLeagueIds(payload));
    if (!hydratedRef.current || turnedOnFreeOnly) {
      hydratedRef.current = true;
      setPriorities(hydratePriorityList(payload, { freeLeaguesOnly: restrictToFreeLeagues }));
      setDesiredLeagueCount(defaultDesiredLeagueCount(payload, { freeLeaguesOnly: restrictToFreeLeagues }));
      setPriorLeagueDecisions(payload.priorLeagueDecisions ?? []);
      setBasicIceFallbackInterest(payload.basicIceFallbackInterest === true);
      setPlayInEntry(payload.playInEntry ?? {});
      knownWaitlistLeagueIdsRef.current = currentWaitlistIds;
      return;
    }
    // Catalog may refresh after the registrant joins a waitlist elsewhere —
    // pull only newly joined leagues onto the list without putting back ones
    // they already removed.
    const previouslyKnownWaitlistLeagueIds = knownWaitlistLeagueIdsRef.current;
    knownWaitlistLeagueIdsRef.current = currentWaitlistIds;
    setPriorities((current) =>
      filterPrioritiesToAllowedLeagues(
        mergeNewlyJoinedWaitlistLeagues(current, payload, previouslyKnownWaitlistLeagueIds, {
          freeLeaguesOnly: restrictToFreeLeagues,
        }),
        payload.leagues,
        restrictToFreeLeagues,
      ),
    );
    setPlayInEntry(payload.playInEntry ?? {});
  }, [payload, restrictToFreeLeagues]);

  const memberNameById = useMemo(
    () => new Map(memberOptions.options.map((option) => [option.id, option.name])),
    [memberOptions.options],
  );

  const evaluation = useMemo(
    () =>
      evaluatePriorityList({
        priorities,
        leagues,
        desiredLeagueCount,
        returnRightLeagueIds: payload?.returnRightLeagueIds ?? [],
        returnEligibleMemberIdsByLeagueId: payload?.returnEligibleMemberIdsByLeagueId ?? {},
        playInEntry: playInEntry as Record<number, RegistrationPlayInEntrySummary>,
        priorLeagueDecisions,
        registrantMemberId: registeringCurler.id,
      }),
    [
      desiredLeagueCount,
      leagues,
      payload?.returnEligibleMemberIdsByLeagueId,
      payload?.returnRightLeagueIds,
      playInEntry,
      priorLeagueDecisions,
      priorities,
      registeringCurler.id,
    ],
  );

  const labelByLeagueId = useMemo(
    () => new Map(evaluation.entries.map((entry) => [entry.leagueId, entry.label])),
    [evaluation.entries],
  );

  const eligibleLeagues = useMemo(
    () =>
      leagues.filter((league) => {
        if (!isLeagueSelectionEligibleLeague(league, eligibility)) return false;
        if (restrictToFreeLeagues && !isFreeLeague(league)) return false;
        return true;
      }),
    [eligibility, leagues, restrictToFreeLeagues],
  );

  const addableLeagues = useMemo(
    () =>
      availableLeaguesToAdd({
        leagues: eligibleLeagues,
        priorities,
        isEligible: () => true,
      }),
    [eligibleLeagues, priorities],
  );

  const sabbaticals = useMemo(
    () =>
      sabbaticalListEntries({
        continuingSabbaticals: payload?.continuingSabbaticals ?? [],
        priorLeagueDecisions,
        priorities,
        leagues,
        defaultSabbaticalFeeMinor: payload?.sabbaticalFeeMinor ?? 0,
      }),
    [
      leagues,
      payload?.continuingSabbaticals,
      payload?.sabbaticalFeeMinor,
      priorLeagueDecisions,
      priorities,
    ],
  );

  const paidReturnLeagues = useMemo(
    () =>
      restrictToFreeLeagues
        ? paidPriorLeaguesOffList({
            priorSeasonLeagueIds: payload?.priorSeasonLeagueIds ?? [],
            priorities,
            priorLeagueDecisions,
            leagues,
          })
        : [],
    [leagues, payload?.priorSeasonLeagueIds, priorLeagueDecisions, priorities, restrictToFreeLeagues],
  );
  const paidReturnLeaguesWithChoice = useMemo(
    () => paidReturnLeagues.filter((league) => league.allowsSabbatical),
    [paidReturnLeagues],
  );
  const lastSessionLeagueIds = useMemo(
    () => new Set(paidReturnLeaguesWithChoice.map((league) => league.id)),
    [paidReturnLeaguesWithChoice],
  );
  const sabbaticalsToShow = useMemo(
    () => sabbaticals.filter((entry) => entry.kind === 'continuing' || !lastSessionLeagueIds.has(entry.leagueId)),
    [lastSessionLeagueIds, sabbaticals],
  );
  const omittedWaitlists = useMemo(
    () => (payload ? omittedWaitlistLeagues(payload, priorities) : []),
    [payload, priorities],
  );

  const maxSelectableCount = Math.min(
    MAX_DESIRED_LEAGUE_COUNT,
    Math.max(eligibleLeagues.length, 1),
  );

  // Re-evaluates a play-in league's TLINE guarantee against the roster as typed.
  const refreshPlayInPreview = useCallback(
    async (leagueId: number, priority: LeaguePriorityInput) => {
      if (registeringCurler.id == null) return;
      const memberIds = (priority.teamRosterPlacements ?? []).map((placement) => placement.memberId);
      try {
        const { data } = await api.get<RegistrantPlayInEntrySummaryLike>(
          `/registration/leagues/${leagueId}/play-in-entry-preview`,
          {
            params: {
              memberId: registeringCurler.id,
              memberIds: memberIds.join(','),
              pendingNames: priority.byotTeammateText ?? '',
            },
          },
        );
        setPlayInEntry((current) => ({ ...current, [leagueId]: data }));
      } catch {
        // Leave the previous evaluation in place; the server re-checks on save.
      }
    },
    [registeringCurler.id],
  );

  const updateRoster = (leagueId: number, update: Partial<LeaguePriorityInput>) => {
    setPriorities((current) => {
      const next = updatePriorityRoster(current, leagueId, update);
      const league = leagueById.get(leagueId);
      const updated = next.find((priority) => priority.leagueId === leagueId);
      if (league?.isPlayInBased && updated) void refreshPlayInPreview(leagueId, updated);
      return next;
    });
  };

  const moveLeague = (leagueId: number, direction: 'up' | 'down') => {
    setPriorities((current) => movePriorityInList(current, leagueId, direction, leagues));
    setValidationMessage(null);
  };

  const isPriorSeasonLeague = (leagueId: number) => (payload?.priorSeasonLeagueIds ?? []).includes(leagueId);

  const applyRemoval = (leagueId: number, decision: 'sabbatical' | 'drop' | null) => {
    setPriorities((current) => removePriority(current, leagueId, leagues));
    setPriorLeagueDecisions((current) => {
      const without = current.filter((entry) => entry.leagueId !== leagueId);
      return decision ? [...without, { leagueId, decision }] : without;
    });
    setRemovalPrompt(null);
    setValidationMessage(null);
  };

  const requestRemoval = async (league: LeagueCatalogItem) => {
    if (isPriorSeasonLeague(league.id) && league.allowsSabbatical) {
      setRemovalPrompt({ league, decision: null });
      return;
    }
    if (isPriorSeasonLeague(league.id)) {
      const confirmed = await confirm({
        title: 'Remove league',
        message: `${league.name} does not offer sabbaticals. Removing it gives up your return right.`,
        confirmText: 'Drop',
      });
      if (confirmed) applyRemoval(league.id, 'drop');
      return;
    }
    const confirmed = await confirm({
      title: 'Remove league',
      message: `Remove ${league.name} from your priority list?`,
      confirmText: 'Remove',
    });
    if (confirmed) applyRemoval(league.id, null);
  };

  const addLeague = (leagueId: number) => {
    const league = leagueById.get(leagueId);
    if (restrictToFreeLeagues && !isFreeLeague(league)) return;
    setPriorities((current) => addPriority(current, leagueId, leagues));
    setPriorLeagueDecisions((current) => current.filter((entry) => entry.leagueId !== leagueId));
    setValidationMessage(null);
  };

  const applyContinuingSabbaticalChoice = (
    leagueId: number,
    choice: 'sabbatical' | 'return' | 'drop',
  ) => {
    if (choice === 'return') {
      const league = leagueById.get(leagueId);
      if (restrictToFreeLeagues && !isFreeLeague(league)) return;
      setPriorities((current) => addPriorityAtTop(current, leagueId, leagues));
      setPriorLeagueDecisions((current) => current.filter((entry) => entry.leagueId !== leagueId));
    } else {
      setPriorities((current) => removePriority(current, leagueId, leagues));
      setPriorLeagueDecisions((current) => {
        const without = current.filter((entry) => entry.leagueId !== leagueId);
        return [...without, { leagueId, decision: choice }];
      });
    }
    setValidationMessage(null);
  };

  const setSabbaticalDecision = (leagueId: number, decision: 'sabbatical' | 'drop') => {
    setPriorLeagueDecisions((current) => {
      const without = current.filter((entry) => entry.leagueId !== leagueId);
      return [...without, { leagueId, decision }];
    });
    setValidationMessage(null);
  };

  useEffect(() => {
    const autoDrops = paidReturnLeagues.filter((league) => !league.allowsSabbatical);
    if (autoDrops.length === 0) return;
    setPriorLeagueDecisions((current) => {
      const decided = new Set(current.map((entry) => entry.leagueId));
      const additions = autoDrops
        .filter((league) => !decided.has(league.id))
        .map((league) => ({ leagueId: league.id, decision: 'drop' as const }));
      if (additions.length === 0) return current;
      return [...current, ...additions];
    });
  }, [paidReturnLeagues]);

  const firstValidationMessage = (): string | null => {
    const count = desiredLeagueCount ?? 0;
    if (priorities.length === 0 && count > 0) {
      return 'Add at least one league to your priority list, or set the number of leagues to play to zero.';
    }
    if (count > priorities.length) {
      return `You asked for ${count} leagues but listed only ${priorities.length}. Add more leagues or lower the count.`;
    }
    if (restrictToFreeLeagues) {
      const paid = priorities.find((priority) => !isFreeLeague(leagueById.get(priority.leagueId)));
      if (paid) {
        const name = leagueById.get(paid.leagueId)?.name ?? 'a paid league';
        return `Basic ice privileges only include free leagues. Remove ${name} or choose league play.`;
      }
    }
    for (const priority of priorities) {
      const league = leagueById.get(priority.leagueId);
      if (!league) continue;
      const roster = countPriorityRoster(priority, registeringCurler.id);
      const expectedSize = expectedByotRosterSize(league);
      if (league.isPlayInBased && roster.total === 0) {
        return `Include at least one person on your ${league.name} roster.`;
      }
      if (league.isPlayInBased && roster.total < MIN_PLAY_IN_ROSTER_SIZE) {
        return `${league.name} needs at least ${MIN_PLAY_IN_ROSTER_SIZE} players on the team to enter.`;
      }
      if (
        league.leagueType === 'bring_your_own_team' &&
        !league.isPlayInBased &&
        expectedSize != null &&
        roster.total !== expectedSize
      ) {
        return `${league.name} needs a full team of ${expectedSize}.`;
      }
    }
    const undecided = undecidedPriorLeagueIds({
      priorSeasonLeagueIds: payload?.priorSeasonLeagueIds ?? [],
      priorities,
      priorLeagueDecisions,
    });
    if (undecided.length > 0) {
      const name = leagueById.get(undecided[0])?.name ?? 'a league you played last session';
      return `Tell us whether you are taking a sabbatical from ${name} or dropping it.`;
    }
    const undecidedContinuing = undecidedContinuingSabbaticalIds({
      continuingSabbaticals: payload?.continuingSabbaticals ?? [],
      priorities,
      priorLeagueDecisions,
    });
    if (undecidedContinuing.length > 0) {
      const continuing = (payload?.continuingSabbaticals ?? []).find(
        (entry) => entry.leagueId === undecidedContinuing[0],
      );
      const name = continuing?.leagueName ?? 'a league you held on sabbatical';
      return `Choose whether to return, extend sabbatical, or drop ${name} before continuing.`;
    }
    const superfluous = evaluation.entries.find((entry) => entry.label === 'superfluous');
    if (superfluous) {
      const name = leagueById.get(superfluous.leagueId)?.name ?? 'A league';
      return `${name} is below the leagues that already fill the number you asked for. Remove it, or move it higher if you want it as a switch with guaranteed fallback.`;
    }
    return null;
  };

  const handleContinue = async () => {
    const message = firstValidationMessage();
    if (message) {
      setValidationMessage(message);
      return;
    }
    setValidationMessage(null);
    for (const leagueName of incompletePlayInLeagueNames(priorities, leagues, registeringCurler.id)) {
      const proceed = await confirm({
        title: 'Incomplete roster',
        message: `You have not entered a full roster for ${leagueName}. The league coordinator will try to help find a team for you, but no guarantee can be made.`,
        confirmText: 'Continue',
        cancelText: 'Go back',
        variant: 'warning',
      });
      if (!proceed) return;
    }
    try {
      await onSave({
        desiredLeagueCount: desiredLeagueCount && desiredLeagueCount > 0 ? desiredLeagueCount : null,
        priorities,
        priorLeagueDecisions,
        basicIceFallbackInterest: payload?.collectBasicIceFallback ? basicIceFallbackInterest : null,
      });
    } catch (error) {
      showAlert(
        error instanceof Error ? error.message : 'Unable to save your league priorities.',
        'error',
        'Save failed',
      );
    }
  };

  if (!payload) {
    return <InlineStateMessage title="Loading leagues..." />;
  }

  const showBasicIceFallback = payload.collectBasicIceFallback && immediateChargeEntries(evaluation).length === 0;
  const showLeaguePicker = eligibleLeagues.length > 0;
  const showEmptyEligible =
    !showLeaguePicker && paidReturnLeaguesWithChoice.length === 0 && sabbaticalsToShow.length === 0;

  return (
    <div className="space-y-6">
      {showEmptyEligible ? (
        <PublicStateCard
          title="No eligible leagues"
          description={
            restrictToFreeLeagues
              ? 'There are no free leagues available for this curler this session. You can continue to review your registration.'
              : 'There are no leagues available for this curler\'s age and experience path this session. You can continue to review your registration.'
          }
          tone="warning"
        />
      ) : (
        <>
          {showLeaguePicker ? (
          <FormField
            label="How many leagues do you want to play?"
            htmlFor={countInputId}
            tone="public"
            required
            helperText={
              restrictToFreeLeagues
                ? 'Only free leagues are included with basic ice privileges. We will place you in up to this many, working down your list.'
                : 'We will place you in up to this many leagues, working down your list.'
            }
            helperPlacement="after-label"
          >
            <ChoiceInput
              inputId={countInputId}
              layout="inline"
              value={desiredLeagueCount}
              onChange={(next) => {
                setDesiredLeagueCount(typeof next === 'number' ? next : null);
                setValidationMessage(null);
              }}
              options={[
                ...(restrictToFreeLeagues ? [{ value: 0, label: '0' }] : []),
                ...Array.from({ length: maxSelectableCount }, (_, index) => ({
                  value: index + 1,
                  label: String(index + 1),
                })),
              ]}
            />
          </FormField>
          ) : null}

          {paidReturnLeaguesWithChoice.length > 0 ? (
            <div role="group" aria-labelledby={paidReturnLabelId} className="space-y-3">
              <div>
                <h2 id={paidReturnLabelId} className="app-section-title">
                  Last session leagues
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                  Basic ice privileges cannot keep a guaranteed return to a paid league. Take a sabbatical or drop each
                  of these.
                </p>
              </div>
              {paidReturnLeaguesWithChoice.map((league) => {
                const schedule = leagueScheduleText(league);
                const decision =
                  priorLeagueDecisions.find((entry) => entry.leagueId === league.id)?.decision ?? null;
                return (
                <div key={league.id} className="app-card space-y-3 p-4">
                  <div>
                    <div className="font-medium text-gray-900">{league.name}</div>
                    {schedule ? <p className="mt-1 text-sm text-gray-600">{schedule}</p> : null}
                  </div>
                  <ChoiceInput
                    layout="block"
                    ariaLabel={`Sabbatical or drop for ${league.name}`}
                    value={decision}
                    onChange={(next) => {
                      if (next === 'sabbatical' || next === 'drop') {
                        setSabbaticalDecision(league.id, next);
                      }
                    }}
                    options={[
                      {
                        value: 'sabbatical',
                        label: 'Take a sabbatical',
                        description: `Hold your return right for a future session. A ${formatCurrency(payload.sabbaticalFeeMinor ?? 0)} sabbatical fee applies each session you maintain this sabbatical.`,
                      },
                      {
                        value: 'drop',
                        label: 'Drop the league',
                        description: 'Give up your return right. You can rejoin later through the waitlist.',
                      },
                    ]}
                  />
                </div>
                );
              })}
            </div>
          ) : null}

          {showLeaguePicker ? (
          <div role="group" aria-labelledby={listLabelId} className="space-y-3">
            <div>
              <h2 id={listLabelId} className="app-section-title">
                Your league priority list
              </h2>
            </div>

            {priorities.length === 0 ? (
              <InlineStateMessage
                title="Your list is empty"
                description={
                  restrictToFreeLeagues
                    ? 'Add any free leagues you want, most wanted first.'
                    : 'Add the leagues you want to play, most wanted first.'
                }
              />
            ) : (
              <SortableList
                items={priorities}
                itemNoun="league"
                getId={(priority) => priority.leagueId}
                getItemLabel={(priority) => leagueById.get(priority.leagueId)?.name ?? 'League'}
                canDropOnItem={(active, over) => canReorderPriorityDrop(active, over, leagues)}
                onReorder={(next) => {
                  setPriorities(reorderPriorities(next, leagues));
                  setValidationMessage(null);
                }}
                renderItem={({ item, index, dragHandle, isInvalidDropTarget }) => {
                  const league = leagueById.get(item.leagueId);
                  if (!league) return null;
                  const label = labelByLeagueId.get(item.leagueId) ?? 'subject_to_availability';
                  const needsRoster =
                    league.leagueType === 'bring_your_own_team' || league.isPlayInBased === true;
                  const canMoveUp = canMovePriority(priorities, item.leagueId, 'up', leagues);
                  const canMoveDown = canMovePriority(priorities, item.leagueId, 'down', leagues);
                  const moveUpTitle = priorityMoveButtonTitle(
                    priorities,
                    item.leagueId,
                    'up',
                    leagues,
                    league.name,
                  );
                  const moveDownTitle = priorityMoveButtonTitle(
                    priorities,
                    item.leagueId,
                    'down',
                    leagues,
                    league.name,
                  );
                  return (
                    <div
                      className={`app-card space-y-3 p-4 transition-[opacity,filter] ${
                        isInvalidDropTarget ? 'pointer-events-none opacity-40 grayscale' : ''
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="pt-1">{dragHandle}</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-gray-500">{index + 1}.</span>
                            <span className="font-medium text-gray-900">{league.name}</span>
                            {shouldShowGuaranteeChip(label) ? (
                              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${guaranteeChipClassName(label)}`}>
                                {guaranteeChipLabel(label)}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-sm text-gray-600">{leagueRowSubtitle(league)}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => void requestRemoval(league)}
                          >
                            Remove
                          </Button>
                          <div className="flex flex-col">
                            <span title={moveUpTitle} className="inline-flex">
                              <button
                                type="button"
                                aria-label={moveUpTitle ?? `Move ${league.name} up`}
                                disabled={!canMoveUp}
                                onClick={() => moveLeague(league.id, 'up')}
                                className="inline-flex h-7 w-8 items-center justify-center rounded-md text-gray-500 transition-colors enabled:hover:bg-gray-100 enabled:hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-40 dark:enabled:hover:bg-gray-700 dark:enabled:hover:text-gray-100"
                              >
                                <HiChevronUp className="h-4 w-4" aria-hidden />
                              </button>
                            </span>
                            <span title={moveDownTitle} className="inline-flex">
                              <button
                                type="button"
                                aria-label={moveDownTitle ?? `Move ${league.name} down`}
                                disabled={!canMoveDown}
                                onClick={() => moveLeague(league.id, 'down')}
                                className="inline-flex h-7 w-8 items-center justify-center rounded-md text-gray-500 transition-colors enabled:hover:bg-gray-100 enabled:hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-40 dark:enabled:hover:bg-gray-700 dark:enabled:hover:text-gray-100"
                              >
                                <HiChevronDown className="h-4 w-4" aria-hidden />
                              </button>
                            </span>
                          </div>
                        </div>
                      </div>
                      {needsRoster ? (
                        <PriorityRosterField
                          league={league}
                          priority={item}
                          inputId={`priority-roster-${league.id}`}
                          registeringCurler={registeringCurler}
                          memberNameById={memberNameById}
                          required={!league.isPlayInBased}
                          helperText={
                            league.isPlayInBased
                              ? `List at least ${MIN_PLAY_IN_ROSTER_SIZE} players to enter as a team.`
                              : 'Guaranteed return requires a full roster of returning players. Teams with new players go on the waitlist.'
                          }
                          playInCommittedOtherMemberTeams={playInEntry[league.id]?.committedOtherMemberTeams}
                          playInCommittedOtherMemberIds={playInEntry[league.id]?.committedOtherMemberIds}
                          onChange={(update) => updateRoster(league.id, update)}
                        />
                      ) : null}
                    </div>
                  );
                }}
              />
            )}

            {removalPrompt ? (
              <ConfirmDialog
                isOpen
                title="Remove league"
                message={`You played ${removalPrompt.league.name} last session. What would you like to do with your spot?`}
                confirmText="Confirm"
                cancelText="Cancel"
                confirmDisabled={removalPrompt.decision == null}
                onConfirm={() => applyRemoval(removalPrompt.league.id, removalPrompt.decision)}
                onCancel={() => setRemovalPrompt(null)}
              >
                <ChoiceInput
                  layout="block"
                  ariaLabel={`Sabbatical or drop for ${removalPrompt.league.name}`}
                  value={removalPrompt.decision}
                  onChange={(next) =>
                    setRemovalPrompt((current) =>
                      current ? { ...current, decision: next === 'sabbatical' ? 'sabbatical' : 'drop' } : current,
                    )
                  }
                  options={[
                    {
                      value: 'sabbatical',
                      label: 'Take a sabbatical',
                      description: `Hold your return right for a future session. A ${formatCurrency(payload?.sabbaticalFeeMinor ?? 0)} sabbatical fee applies each session you maintain this sabbatical.`,
                    },
                    {
                      value: 'drop',
                      label: 'Drop the league',
                      description: 'Give up your return right. You can rejoin later through the waitlist.',
                    },
                  ]}
                />
              </ConfirmDialog>
            ) : null}

            {addableLeagues.length > 0 ? (
              <FormField
                label="Add a league"
                htmlFor={addLeagueInputId}
                tone="public"
              >
                <ChoiceInput
                  inputId={addLeagueInputId}
                  layout="popover"
                  value={null}
                  placeholder={restrictToFreeLeagues ? 'Select a free league' : 'Select a league'}
                  onChange={(next) => {
                    if (typeof next === 'number') addLeague(next);
                  }}
                  options={addableLeagues.map((league) => ({
                    value: league.id,
                    label: league.name,
                    description: leagueRowSubtitle(league),
                  }))}
                />
              </FormField>
            ) : null}
          </div>
          ) : null}

            {sabbaticalsToShow.length > 0 ? (
              <div role="group" aria-labelledby={sabbaticalsLabelId} className="space-y-3">
                <h3 id={sabbaticalsLabelId} className="app-section-title">
                  Sabbaticals
                </h3>
                {sabbaticalsToShow.map((entry) => {
                  const feeText = formatCurrency(entry.sabbaticalFeeMinor);
                  const canReturnToList =
                    !restrictToFreeLeagues || isFreeLeague(leagueById.get(entry.leagueId));
                  return (
                    <div key={entry.leagueId} className="app-card space-y-3 p-4">
                      <div>
                        <div className="font-medium text-gray-900">{entry.leagueName}</div>
                        <p className="mt-1 text-sm text-gray-600">
                          {entry.kind === 'continuing'
                            ? canReturnToList
                              ? `You held a sabbatical for this league last session. Extend it (${feeText} this session), return with guaranteed return, or drop it.`
                              : `You held a sabbatical for this league last session. Extend it (${feeText} this session) or drop it. Basic ice privileges cannot return you to a paid league.`
                            : `Holding a sabbatical for this league (${feeText} this session).`}
                        </p>
                        {entry.kind === 'continuing' &&
                        entry.decision === 'sabbatical' &&
                        entry.extensionBlockedMessage ? (
                          <FormFieldMessage tone="public" intent="error">
                            {entry.extensionBlockedMessage}
                          </FormFieldMessage>
                        ) : null}
                      </div>
                      {entry.kind === 'continuing' ? (
                        <ChoiceInput
                          layout="block"
                          ariaLabel={`Sabbatical decision for ${entry.leagueName}`}
                          value={entry.decision}
                          onChange={(next) => {
                            if (next === 'return' || next === 'sabbatical' || next === 'drop') {
                              applyContinuingSabbaticalChoice(entry.leagueId, next);
                            }
                          }}
                          options={[
                            {
                              value: 'sabbatical',
                              label: 'Extend sabbatical',
                              description: `Keep your return right for a future session. A ${feeText} sabbatical fee applies this session.`,
                              disabled: !entry.canExtend,
                            },
                            ...(canReturnToList
                              ? [
                                  {
                                    value: 'return' as const,
                                    label: 'Return to this league',
                                    description: 'Add it to your priority list with guaranteed return.',
                                  },
                                ]
                              : []),
                            {
                              value: 'drop',
                              label: 'Drop',
                              description: 'Give up your return right. You can rejoin later through the waitlist.',
                            },
                          ]}
                        />
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {canReturnToList ? (
                            <Button type="button" variant="secondary" onClick={() => addLeague(entry.leagueId)}>
                              Return to priority list
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => setSabbaticalDecision(entry.leagueId, 'drop')}
                          >
                            Drop instead
                          </Button>
                        </div>
                      )}
                      {entry.kind === 'continuing' &&
                      !entry.canExtend &&
                      entry.extensionBlockedMessage &&
                      entry.decision !== 'sabbatical' ? (
                        <FormFieldMessage tone="public" intent="error">
                          {entry.extensionBlockedMessage}
                        </FormFieldMessage>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}

          {showBasicIceFallback ? (
            <FormCheckbox
              tone="public"
              label="Give me basic ice privileges if I cannot be placed in any league"
              checked={basicIceFallbackInterest}
              onChange={setBasicIceFallbackInterest}
              helperText="Basic ice privileges allow unlimited sparing, practice, daytime leagues, and early morning sessions."
            />
          ) : null}
        </>
      )}

      {omittedWaitlists.length > 0 ? (
        <div
          className="app-alert border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200"
          role="status"
        >
          {omittedWaitlistNotice(omittedWaitlists)}
        </div>
      ) : null}

      {validationMessage ? (
        <FormFieldMessage tone="public" intent="error">
          {validationMessage}
        </FormFieldMessage>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="button" disabled={saving} onClick={() => void handleContinue()}>
          {continueLabel}
        </Button>
      </div>
    </div>
  );
}

/** Shape actually consumed from the play-in preview endpoint. */
type RegistrantPlayInEntrySummaryLike = RegistrationPlayInEntrySummary;
