import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Button from '../Button';
import ChoiceInput from '../ChoiceInput';
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
  countPriorityRoster,
  evaluatePriorityList,
  expectedByotRosterSize,
  guaranteeChipClassName,
  guaranteeChipLabel,
  MAX_DESIRED_LEAGUE_COUNT,
  MIN_PLAY_IN_ROSTER_SIZE,
  removePriority,
  reorderPriorities,
  seedPriorityList,
  undecidedPriorLeagueIds,
  updatePriorityRoster,
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
  onSave,
}: Props) {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const memberOptions = useMemberOptions({ autoLoad: true });
  const countInputId = useId();
  const addLeagueInputId = useId();
  const listLabelId = useId();

  const [priorities, setPriorities] = useState<LeaguePriorityInput[]>([]);
  const [desiredLeagueCount, setDesiredLeagueCount] = useState<number | null>(null);
  const [priorLeagueDecisions, setPriorLeagueDecisions] = useState<PriorLeagueDecision[]>([]);
  const [basicIceFallbackInterest, setBasicIceFallbackInterest] = useState<boolean>(false);
  const [removalPrompt, setRemovalPrompt] = useState<RemovalPrompt | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [playInEntry, setPlayInEntry] = useState<Record<number, RegistrantPlayInEntrySummaryLike>>({});
  const hydratedRef = useRef(false);

  const leagues = useMemo(() => payload?.leagues ?? [], [payload]);
  const leagueById = useMemo(
    () => new Map(leagues.map((league) => [league.id, league])),
    [leagues],
  );

  useEffect(() => {
    if (!payload || hydratedRef.current) return;
    hydratedRef.current = true;
    const seeded = payload.priorities.length > 0 ? payload.priorities : seedPriorityList(payload);
    setPriorities(seeded);
    setDesiredLeagueCount(payload.desiredLeagueCount ?? (seeded.length > 0 ? seeded.length : null));
    setPriorLeagueDecisions(payload.priorLeagueDecisions ?? []);
    setBasicIceFallbackInterest(payload.basicIceFallbackInterest === true);
    setPlayInEntry(payload.playInEntry ?? {});
  }, [payload]);

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
        playInEntry: playInEntry as Record<number, RegistrationPlayInEntrySummary>,
        priorLeagueDecisions,
        registrantMemberId: registeringCurler.id,
      }),
    [
      desiredLeagueCount,
      leagues,
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
    () => leagues.filter((league) => isLeagueSelectionEligibleLeague(league, eligibility)),
    [eligibility, leagues],
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
    if (isPriorSeasonLeague(league.id)) {
      setRemovalPrompt({ league, decision: null });
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
    setPriorities((current) => addPriority(current, leagueId, leagues));
    setPriorLeagueDecisions((current) => current.filter((entry) => entry.leagueId !== leagueId));
    setValidationMessage(null);
  };

  const firstValidationMessage = (): string | null => {
    const count = desiredLeagueCount ?? 0;
    if (priorities.length === 0 && count > 0) {
      return 'Add at least one league to your priority list, or set the number of leagues to play to zero.';
    }
    if (count > priorities.length) {
      return `You asked for ${count} leagues but listed only ${priorities.length}. Add more leagues or lower the count.`;
    }
    for (const priority of priorities) {
      const league = leagueById.get(priority.leagueId);
      if (!league) continue;
      const roster = countPriorityRoster(priority, registeringCurler.id);
      const expectedSize = expectedByotRosterSize(league);
      if (league.isPlayInBased && roster.total > 0 && roster.total < MIN_PLAY_IN_ROSTER_SIZE) {
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
    return null;
  };

  const handleContinue = async () => {
    const message = firstValidationMessage();
    if (message) {
      setValidationMessage(message);
      return;
    }
    setValidationMessage(null);
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

  const showBasicIceFallback = payload.collectBasicIceFallback && evaluation.guaranteedCount === 0;

  return (
    <div className="space-y-6">
      {eligibleLeagues.length === 0 ? (
        <PublicStateCard
          title="No eligible leagues"
          description="There are no leagues available for this curler's age and experience path this session. You can continue to review your registration."
          tone="warning"
        />
      ) : (
        <>
          <FormField
            label="How many leagues do you want to play?"
            htmlFor={countInputId}
            tone="public"
            required
            helperText="We will place you in up to this many leagues, working down your list."
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
              options={Array.from({ length: maxSelectableCount }, (_, index) => ({
                value: index + 1,
                label: String(index + 1),
              }))}
            />
          </FormField>

          <div role="group" aria-labelledby={listLabelId} className="space-y-3">
            <div>
              <h2 id={listLabelId} className="app-section-title">
                Your league priority list
              </h2>
            </div>

            {priorities.length === 0 ? (
              <InlineStateMessage
                title="Your list is empty"
                description="Add the leagues you want to play, most wanted first."
              />
            ) : (
              <SortableList
                items={priorities}
                itemNoun="league"
                getId={(priority) => priority.leagueId}
                getItemLabel={(priority) => leagueById.get(priority.leagueId)?.name ?? 'League'}
                onReorder={(next) => {
                  setPriorities(reorderPriorities(next, leagues));
                  setValidationMessage(null);
                }}
                renderItem={({ item, index, dragHandle }) => {
                  const league = leagueById.get(item.leagueId);
                  if (!league) return null;
                  const label = labelByLeagueId.get(item.leagueId) ?? 'subject_to_availability';
                  const needsRoster =
                    league.leagueType === 'bring_your_own_team' || league.isPlayInBased === true;
                  return (
                    <div className="app-card space-y-3 p-4">
                      <div className="flex items-start gap-3">
                        <div className="pt-1">{dragHandle}</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-gray-500">{index + 1}.</span>
                            <span className="font-medium text-gray-900">{league.name}</span>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${guaranteeChipClassName(label)}`}>
                              {guaranteeChipLabel(label)}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-gray-600">{leagueRowSubtitle(league)}</p>
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => void requestRemoval(league)}
                        >
                          Remove
                        </Button>
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
                              ? `List at least ${MIN_PLAY_IN_ROSTER_SIZE} players to enter as a team. A full team over the points bar earns guaranteed entry.`
                              : 'A complete team is required before this league can be guaranteed.'
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
              <div className="app-card space-y-3 p-4">
                <p className="text-sm text-gray-700">
                  You played {removalPrompt.league.name} last session. What would you like to do with your spot?
                </p>
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
                      description:
                        'Hold your return right for a future session. A sabbatical fee applies and uses one of your two guaranteed spots.',
                      disabled: !removalPrompt.league.allowsSabbatical,
                    },
                    {
                      value: 'drop',
                      label: 'Drop the league',
                      description: 'Give up your return right. You can rejoin later through the waitlist.',
                    },
                  ]}
                />
                <div className="flex flex-wrap gap-3">
                  <Button
                    type="button"
                    disabled={removalPrompt.decision == null}
                    onClick={() => applyRemoval(removalPrompt.league.id, removalPrompt.decision)}
                  >
                    Remove league
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setRemovalPrompt(null)}>
                    Keep it on my list
                  </Button>
                </div>
              </div>
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
                  placeholder="Select a league"
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

          {showBasicIceFallback ? (
            <FormCheckbox
              tone="public"
              label="Give me basic ice privileges if I cannot be placed in any league"
              checked={basicIceFallbackInterest}
              onChange={setBasicIceFallbackInterest}
              helperText="Basic ice privileges allow unlimited sparing, practice, daytime leagues, and early morning sessions."
            />
          ) : null}

          <div className="rounded-md bg-gray-50 p-4 text-sm text-gray-700">
            {evaluation.confirmedLeagueFeeMinor === evaluation.maximumLeagueFeeMinor ? (
              <p>League fees: {formatCurrency(evaluation.confirmedLeagueFeeMinor)}.</p>
            ) : (
              <p>
                League fees: {formatCurrency(evaluation.confirmedLeagueFeeMinor)} confirmed today, up to{' '}
                {formatCurrency(evaluation.maximumLeagueFeeMinor)} if every league you asked for comes through.
                You will be billed once your placements are settled.
              </p>
            )}
          </div>
        </>
      )}

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
