import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import api from '../../utils/api';
import Button from '../Button';
import ChoiceInput from '../ChoiceInput';
import FormCheckbox from '../FormCheckbox';
import FormField from '../FormField';
import InlineStateMessage from '../InlineStateMessage';
import Modal from '../Modal';
import { useMemberOptions } from '../../contexts/MemberOptionsContext';
import RegistrationByotWaitlistFields from './RegistrationByotWaitlistFields';
import RegistrationWaitlistFulfillmentFields from './RegistrationWaitlistFulfillmentFields';
import RegistrationImmediatePaymentConfirmationModal from './RegistrationImmediatePaymentConfirmationModal';
import type { WaitlistTeamMemberPlacementOptions } from '../waitlists/waitlistTeamRosterShared';
import {
  addWaitlistPriorityFromSelections,
  applyAddWaitlistPriorityOrder,
  defaultDesiredAddWaitlistLeagueCount,
  getAddWaitlistSelections,
  countPriorSeasonProtectedReturnSelections,
  PROTECTED_RETURN_SELECTION_TYPES,
  REAL_LEAGUE_SELECTION_TYPES,
  remainingFirstTwoLeagueSlots,
  requiresWaitlistFulfillmentPreferences,
  editValidationErrorMessage,
  formatWaitlistPositionSuffix,
  firstByotWaitlistRosterValidationMessage,
  hasClubExperienceRecord,
  isJuniorRecreationalEligibleDate,
  isLeagueSelectionEligibleLeague,
  isThirdLeagueInterestEligibleLeague,
  isThirdLeagueInterestSelection,
  leagueScheduleText,
  loadMembershipEditContext,
  loadRegistrationEditContext,
  continuingSabbaticalForLeague,
  formatCurrency,
  priorLeagueChoiceValue,
  priorSeasonReturnLeaguesFromPayload,
  registrationDiscountLabel,
  saveLeagueSelections,
  setThirdLeagueInterestSelections,
  submitRegistrationEdits,
  submitStaffRegistrationEdits,
  updateByotTeammates,
  updateLeagueSelection,
  updateWaitlistReplaceSelection,
  waitlistJoinOptionDescription,
  type IcePrivilegesChoice,
  type LeagueEligibilityInput,
  type RegistrationLeagueEvaluation,
  type RegistrationLeagueSelectionPayload,
  type RegistrationMembershipPaymentPayload,
  type RegistrationSelectionInput,
  type RegistrationSelectionType,
  type RegistrationShellCurler,
  type RegistrationWindow,
  type SubmitRegistrationEditsResult,
} from './registrationViewEditShared';

export type RegistrationEditModalKind =
  | 'membership'
  | 'confirmedLeagues'
  | 'sabbaticals'
  | 'waitlists'
  | 'thirdLeague'
  | 'byot'
  | null;

type SharedEditProps = {
  registrationId: number;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  finalizeEdits: (input: {
    evaluation?: RegistrationLeagueEvaluation | RegistrationMembershipPaymentPayload;
    onSaved: () => void | Promise<void>;
    setSaving: (saving: boolean) => void;
    setError: (error: string | null) => void;
  }) => Promise<void>;
};

function EditModalShell({
  isOpen,
  title,
  onClose,
  saving,
  error,
  onSave,
  children,
}: {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="lg" verticalAlign="start">
      <div className="space-y-4">
        {children}
        {error ? <InlineStateMessage tone="error" title={error} /> : null}
        <div className="flex flex-wrap justify-end gap-3 border-t border-gray-200 pt-4 dark:border-gray-700">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={onSave}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function useLeagueEditState(registrationId: number, isOpen: boolean, finalizeEdits: SharedEditProps['finalizeEdits']) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaguePayload, setLeaguePayload] = useState<RegistrationLeagueSelectionPayload | null>(null);
  const [selections, setSelections] = useState<RegistrationSelectionInput[]>([]);
  const [desiredAddWaitlistLeagueCount, setDesiredAddWaitlistLeagueCount] = useState<number | null>(null);
  const [addWaitlistPriority, setAddWaitlistPriority] = useState<number[]>([]);
  const [windowState, setWindowState] = useState<RegistrationWindow | null>(null);
  const [curler, setCurler] = useState<RegistrationShellCurler | null>(null);
  const [membership, setMembership] = useState<RegistrationMembershipPaymentPayload | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void loadRegistrationEditContext(registrationId)
      .then((context) => {
        if (cancelled) return;
        setLeaguePayload(context.league);
        setSelections(context.league.selections);
        setAddWaitlistPriority(addWaitlistPriorityFromSelections(context.league.selections));
        setDesiredAddWaitlistLeagueCount(
          requiresWaitlistFulfillmentPreferences(context.league.selections)
            ? (context.league.desiredAddWaitlistLeagueCount ??
                defaultDesiredAddWaitlistLeagueCount(context.league.activeLeagueIds, context.league.selections))
            : null,
        );
        setWindowState(context.window);
        setCurler(context.curler);
        setMembership(context.membership);
      })
      .catch((err) => {
        if (!cancelled) setError(editValidationErrorMessage(err, 'Unable to load league choices.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, registrationId]);

  const priorSeasonReturnLeagues = useMemo(
    () => priorSeasonReturnLeaguesFromPayload(leaguePayload, windowState?.state),
    [leaguePayload, windowState?.state],
  );

  const priorSeasonReturnLeagueIds = useMemo(
    () => new Set(priorSeasonReturnLeagues.map((league) => league.id)),
    [priorSeasonReturnLeagues],
  );

  const selectedLeagueIds = useMemo(
    () =>
      new Set(
        selections
          .filter((selection) => selection.leagueId != null && !isThirdLeagueInterestSelection(selection))
          .map((selection) => selection.leagueId as number),
      ),
    [selections],
  );

  const waitlistEligibleLeagues = useMemo(
    () =>
      (leaguePayload?.leagues ?? []).filter(
        (league) =>
          league.allowsWaitlist &&
          isLeagueSelectionEligibleLeague(league, {
            dateOfBirth: curler?.dateOfBirth,
            experienceType: membership?.selection.experienceType ?? 'none_or_minimal',
            experienceSelfReportedYears: membership?.selection.experienceSelfReportedYears,
            knownExperienceYears: membership?.knownExperienceYears,
            membershipOption: membership?.selection.membershipOption,
          }),
      ),
    [curler?.dateOfBirth, leaguePayload, membership],
  );

  const leagueCatalogOrder = useMemo(() => {
    const order = new Map<number, number>();
    (leaguePayload?.leagues ?? []).forEach((league, index) => order.set(league.id, index));
    return order;
  }, [leaguePayload]);

  const priorSeasonProtectedReturnCount = useMemo(
    () => countPriorSeasonProtectedReturnSelections(selections, priorSeasonReturnLeagueIds),
    [selections, priorSeasonReturnLeagueIds],
  );

  const scheduledLeagueSelections = useMemo(
    () => selections.filter((selection) => selection.selectionType === 'guaranteed_return' || selection.selectionType === 'byot_request'),
    [selections],
  );

  const leagueName = useCallback(
    (leagueId: number | null | undefined) =>
      leaguePayload?.leagues.find((league) => league.id === leagueId)?.name ?? `League #${leagueId ?? 'unknown'}`,
    [leaguePayload],
  );

  const selectionLabel = useCallback((selection: RegistrationSelectionInput) => {
    switch (selection.selectionType) {
      case 'guaranteed_return':
        return 'Guaranteed return';
      case 'sabbatical':
        return 'Sabbatical';
      case 'drop':
        return 'Drop';
      case 'byot_request':
        return 'BYOT request';
      case 'waitlist_add':
        return 'Waitlist: ADD';
      case 'waitlist_replace':
        return `Waitlist: REPLACE${selection.replacesLeagueId ? ` (${leagueName(selection.replacesLeagueId)})` : ''}`;
      default:
        return selection.selectionType.replace(/_/g, ' ');
    }
  }, [leagueName]);

  useEffect(() => {
    if (!requiresWaitlistFulfillmentPreferences(selections)) {
      setAddWaitlistPriority([]);
      setDesiredAddWaitlistLeagueCount(null);
      return;
    }
    setAddWaitlistPriority((current) => {
      const activeIds = new Set(getAddWaitlistSelections(selections).map((selection) => selection.leagueId as number));
      const preserved = current.filter((id) => activeIds.has(id));
      const derived = addWaitlistPriorityFromSelections(selections);
      const missing = derived.filter((id) => !preserved.includes(id));
      const next = [...preserved, ...missing];
      if (next.length === current.length && next.every((id, index) => id === current[index])) return current;
      return next;
    });
    setDesiredAddWaitlistLeagueCount((current) => {
      const remaining = remainingFirstTwoLeagueSlots(leaguePayload?.activeLeagueIds ?? [], selections);
      if (remaining <= 0) return null;
      if (remaining <= 1) return 1;
      return current ?? defaultDesiredAddWaitlistLeagueCount(leaguePayload?.activeLeagueIds ?? [], selections);
    });
  }, [selections, leaguePayload?.activeLeagueIds]);

  const saveSelections = async (onSaved: () => void | Promise<void>) => {
    setSaving(true);
    setError(null);
    try {
      const data = await saveLeagueSelections(registrationId, {
        selections,
        desiredAddWaitlistLeagueCount,
        addWaitlistPriority,
      });
      setLeaguePayload(data);
      setSelections(data.selections);
      setAddWaitlistPriority(addWaitlistPriorityFromSelections(data.selections));
      setDesiredAddWaitlistLeagueCount(
        requiresWaitlistFulfillmentPreferences(data.selections)
          ? (data.desiredAddWaitlistLeagueCount ??
              defaultDesiredAddWaitlistLeagueCount(data.activeLeagueIds, data.selections))
          : null,
      );
      await finalizeEdits({
        evaluation: data.evaluation,
        onSaved,
        setSaving,
        setError,
      });
    } catch (err) {
      setError(editValidationErrorMessage(err, 'Unable to save league choices.'));
      setSaving(false);
    }
  };

  return {
    loading,
    saving,
    error,
    setError,
    leaguePayload,
    selections,
    setSelections,
    windowState,
    curler,
    membership,
    priorSeasonReturnLeagues,
    priorSeasonReturnLeagueIds,
    selectedLeagueIds,
    waitlistEligibleLeagues,
    leagueCatalogOrder,
    priorSeasonProtectedReturnCount,
    scheduledLeagueSelections,
    leagueName,
    selectionLabel,
    saveSelections,
    setSaving,
    desiredAddWaitlistLeagueCount,
    setDesiredAddWaitlistLeagueCount,
    addWaitlistPriority,
    setAddWaitlistPriority,
  };
}

function useRegistrationMemberMaps(isOpen: boolean) {
  const memberOptions = useMemberOptions({ autoLoad: isOpen });
  const memberOptionById = useMemo(
    () => new Map(memberOptions.options.map((option) => [option.id, option])),
    [memberOptions.options],
  );
  const memberOptionIdByName = useMemo(
    () => new Map(memberOptions.options.map((option) => [option.name.trim().toLowerCase(), option.id])),
    [memberOptions.options],
  );
  return { memberOptionById, memberOptionIdByName };
}

function byotWaitlistRosterValidationMessage(
  state: Pick<ReturnType<typeof useLeagueEditState>, 'selections' | 'leaguePayload' | 'curler'>,
  memberOptionById: Map<number, { name: string }>,
  memberOptionIdByName: Map<string, number>,
): string | null {
  return firstByotWaitlistRosterValidationMessage(
    state.selections,
    state.leaguePayload?.leagues ?? [],
    memberOptionById,
    memberOptionIdByName,
    { id: state.curler?.id ?? null, name: state.curler?.name ?? 'Registering curler' },
  );
}

function MembershipEditModal({ registrationId, isOpen, onClose, onSaved, finalizeEdits }: SharedEditProps) {
  const membershipInputId = useId();
  const discountsInputId = useId();
  const experienceInputId = useId();
  const icePrivilegesInputId = useId();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [membershipPayment, setMembershipPayment] = useState<RegistrationMembershipPaymentPayload | null>(null);
  const [windowState, setWindowState] = useState<RegistrationWindow | null>(null);
  const [curlerDateOfBirth, setCurlerDateOfBirth] = useState<string | null>(null);
  const [membershipChoice, setMembershipChoice] = useState<'regular' | 'social' | 'junior_recreational'>('regular');
  const [juniorAssistancePercent, setJuniorAssistancePercent] = useState<'0' | '25' | '50' | '75'>('0');
  const [studentDiscountClaimed, setStudentDiscountClaimed] = useState(false);
  const [studentInstitution, setStudentInstitution] = useState('');
  const [reciprocalDiscountClaimed, setReciprocalDiscountClaimed] = useState(false);
  const [reciprocalClubName, setReciprocalClubName] = useState('');
  const [experienceChoice, setExperienceChoice] = useState<'none_or_minimal' | 'specified_years'>('none_or_minimal');
  const [experienceYears, setExperienceYears] = useState('');
  const [icePrivilegesChoice, setIcePrivilegesChoice] = useState<IcePrivilegesChoice | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void loadMembershipEditContext(registrationId)
      .then((context) => {
        if (cancelled) return;
        setMembershipPayment(context.membership);
        setWindowState(context.window);
        setCurlerDateOfBirth(context.curler?.dateOfBirth ?? null);
        const membershipOption = context.membership.selection.membershipOption;
        setMembershipChoice(
          membershipOption === 'junior_recreational' ? 'junior_recreational' : membershipOption === 'social' ? 'social' : 'regular',
        );
        setStudentDiscountClaimed(context.membership.selection.studentDiscountClaimed);
        setStudentInstitution(context.membership.selection.studentInstitution ?? '');
        setReciprocalDiscountClaimed(context.membership.selection.reciprocalDiscountClaimed);
        setReciprocalClubName(context.membership.selection.reciprocalClubName ?? '');
        setExperienceChoice(
          context.membership.selection.experienceType === 'specified_years' ? 'specified_years' : 'none_or_minimal',
        );
        setExperienceYears(context.membership.selection.experienceSelfReportedYears?.toString() ?? '');
        setIcePrivilegesChoice(context.membership.icePrivilegesChoice ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(editValidationErrorMessage(err, 'Unable to load membership details.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, registrationId]);

  const juniorRecreationalEligible = isJuniorRecreationalEligibleDate(curlerDateOfBirth);
  const membershipOptions = useMemo(() => {
    const options: Array<{
      value: 'regular' | 'social' | 'junior_recreational';
      label: string;
      description: string;
    }> = [
      {
        value: 'regular',
        label: 'Regular membership',
        description: 'Choose this if the curler plans to curl, spare, practice, or register for leagues.',
      },
      {
        value: 'social',
        label: 'Social membership',
        description: 'Choose this if the curler wants to be a member but will not curl this session.',
      },
    ];
    if (juniorRecreationalEligible) {
      options.push({
        value: 'junior_recreational' as const,
        label: 'Junior Recreational',
        description: 'Choose this special junior program. It skips normal league selection.',
      });
    }
    return options;
  }, [juniorRecreationalEligible]);

  const discountChoiceOptions = useMemo(
    () => [
      {
        value: 'student' as const,
        label: registrationDiscountLabel('Student discount', windowState?.availableDiscounts?.student),
        description: 'Available for K-12 students and full-time college or university students.',
      },
      {
        value: 'reciprocal' as const,
        label: registrationDiscountLabel('Reciprocal discount', windowState?.availableDiscounts?.reciprocal),
        description: 'Available to members of another dedicated ice or arena curling club.',
      },
    ],
    [windowState?.availableDiscounts],
  );

  const showRegularFields = membershipChoice === 'regular';
  const showExperience = showRegularFields && !hasClubExperienceRecord(membershipPayment?.knownExperienceYears);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/registration/drafts/${registrationId}/membership`, {
        membershipOption: membershipChoice,
        basicIcePrivileges: false,
        juniorAssistancePercent: membershipChoice === 'junior_recreational' ? Number(juniorAssistancePercent) : 0,
      });

      if (membershipChoice === 'social' || membershipChoice === 'junior_recreational') {
        const membershipResponse = await api.get<RegistrationMembershipPaymentPayload>(
          `/registration/drafts/${registrationId}/membership-payment`,
        );
        await finalizeEdits({
          evaluation: membershipResponse.data,
          onSaved,
          setSaving,
          setError,
        });
        return;
      }

      await api.patch(`/registration/drafts/${registrationId}/discounts`, {
        studentDiscountClaimed,
        studentInstitution,
        reciprocalDiscountClaimed,
        reciprocalClubName,
      });

      if (showExperience) {
        await api.patch(`/registration/drafts/${registrationId}/experience`, {
          experienceType: experienceChoice,
          experienceSelfReportedYears: experienceChoice === 'specified_years' ? Number(experienceYears) : null,
        });
      } else if (hasClubExperienceRecord(membershipPayment?.knownExperienceYears)) {
        await api.patch(`/registration/drafts/${registrationId}/experience`, {
          experienceType: 'known_existing',
          experienceSelfReportedYears: null,
        });
      }

      if (!icePrivilegesChoice) {
        setError('Choose an ice privileges option.');
        setSaving(false);
        return;
      }
      const icePrivilegesResponse = await api.patch<RegistrationMembershipPaymentPayload>(
        `/registration/drafts/${registrationId}/ice-privileges`,
        { choice: icePrivilegesChoice },
      );

      await finalizeEdits({
        evaluation: icePrivilegesResponse.data,
        onSaved,
        setSaving,
        setError,
      });
    } catch (err) {
      setError(editValidationErrorMessage(err, 'Unable to save membership changes.'));
      setSaving(false);
    }
  }

  return (
    <EditModalShell
      isOpen={isOpen}
      title="Edit membership"
      onClose={onClose}
      saving={saving}
      error={membershipPayment ? error : null}
      onSave={() => void handleSave()}
    >
      {loading ? (
        <InlineStateMessage title="Loading membership details" description="Gathering the current membership choices." />
      ) : error && !membershipPayment ? (
        <InlineStateMessage tone="error" title={error} description="Close this dialog and try again." />
      ) : (
        <div className="space-y-5">
          <FormField label="Membership type" htmlFor={membershipInputId} required>
            <ChoiceInput
              inputId={membershipInputId}
              layout="block"
              value={membershipChoice}
              onChange={(value) => setMembershipChoice(value as 'regular' | 'social' | 'junior_recreational')}
              options={membershipOptions}
            />
          </FormField>

          {membershipChoice === 'social' ? (
            <InlineStateMessage
              tone="warning"
              title="Social membership"
              description="Social members do not receive discounts, basic ice privileges, or league access."
            />
          ) : null}

          {membershipChoice === 'junior_recreational' ? (
            <FormField label="Financial assistance request" htmlFor={`${membershipInputId}-assistance`}>
              <ChoiceInput
                inputId={`${membershipInputId}-assistance`}
                layout="block"
                value={juniorAssistancePercent}
                onChange={(value) => setJuniorAssistancePercent(value as '0' | '25' | '50' | '75')}
                options={[
                  { value: '0', label: 'No assistance requested' },
                  { value: '25', label: 'Request 25% assistance' },
                  { value: '50', label: 'Request 50% assistance' },
                  { value: '75', label: 'Request 75% assistance' },
                ]}
              />
            </FormField>
          ) : null}

          {showRegularFields ? (
            <>
              {membershipPayment && !membershipPayment.isFirstSessionOfSeason ? (
                <InlineStateMessage
                  tone="neutral"
                  title="Winter-only discount"
                  description="The winter-only discount is available for this session and will be applied to regular membership dues when eligible."
                />
              ) : null}

              <ChoiceInput
                inputId={discountsInputId}
                layout="block"
                maxSelectedItems={null}
                multiSelectionIndicatorStyle="checkboxes"
                ariaLabel="Available discounts"
                value={[
                  ...(studentDiscountClaimed ? ['student'] : []),
                  ...(reciprocalDiscountClaimed ? ['reciprocal'] : []),
                ]}
                onChange={(nextValue) => {
                  const selected = Array.isArray(nextValue) ? nextValue : nextValue ? [nextValue] : [];
                  setStudentDiscountClaimed(selected.includes('student'));
                  setReciprocalDiscountClaimed(selected.includes('reciprocal'));
                }}
                options={discountChoiceOptions}
              />

              {studentDiscountClaimed ? (
                <FormField label="Institution of study" htmlFor="edit-student-institution" required>
                  <input
                    id="edit-student-institution"
                    className="app-input"
                    value={studentInstitution}
                    onChange={(event) => setStudentInstitution(event.target.value)}
                  />
                </FormField>
              ) : null}

              {reciprocalDiscountClaimed ? (
                <FormField label="Other curling club" htmlFor="edit-reciprocal-club" required>
                  <input
                    id="edit-reciprocal-club"
                    className="app-input"
                    value={reciprocalClubName}
                    onChange={(event) => setReciprocalClubName(event.target.value)}
                  />
                </FormField>
              ) : null}

              {showExperience ? (
                <>
                  <FormField label="Previous curling experience" htmlFor={experienceInputId} required>
                    <ChoiceInput
                      inputId={experienceInputId}
                      layout="block"
                      value={experienceChoice}
                      onChange={(value) => setExperienceChoice(value as 'none_or_minimal' | 'specified_years')}
                      options={[
                        { value: 'none_or_minimal', label: 'None or minimal' },
                        { value: 'specified_years', label: 'I have curled before' },
                      ]}
                    />
                  </FormField>
                  {experienceChoice === 'specified_years' ? (
                    <FormField label="Years of experience" htmlFor="edit-experience-years" required>
                      <input
                        id="edit-experience-years"
                        type="number"
                        step="0.5"
                        className="app-input"
                        value={experienceYears}
                        onChange={(event) => setExperienceYears(event.target.value)}
                      />
                    </FormField>
                  ) : null}
                </>
              ) : hasClubExperienceRecord(membershipPayment?.knownExperienceYears) ? (
                <InlineStateMessage
                  tone="neutral"
                  title="Club experience on file"
                  description="This curler's club curling experience is already recorded."
                />
              ) : null}

              <FormField label="Ice privileges" htmlFor={icePrivilegesInputId} required>
                <ChoiceInput
                  inputId={icePrivilegesInputId}
                  layout="block"
                  value={icePrivilegesChoice}
                  onChange={(raw) => setIcePrivilegesChoice((raw as IcePrivilegesChoice | null) ?? null)}
                  options={[
                    {
                      value: 'league_play',
                      label: 'League play',
                      description: 'Evening and weekend leagues.',
                    },
                    {
                      value: 'basic_ice',
                      label: 'Basic ice privileges',
                      description: 'Sparing, practice, and daytime leagues.',
                    },
                    {
                      value: 'none',
                      label: 'No ice privileges',
                      description: 'Full membership without on-ice access.',
                    },
                  ]}
                />
              </FormField>
            </>
          ) : null}
        </div>
      )}
    </EditModalShell>
  );
}

function PriorLeagueEditModal({
  registrationId,
  isOpen,
  onClose,
  onSaved,
  finalizeEdits,
  title,
}: SharedEditProps & { title: string }) {
  const state = useLeagueEditState(registrationId, isOpen, finalizeEdits);
  const { memberOptionById, memberOptionIdByName } = useRegistrationMemberMaps(isOpen);
  const showsAvailabilityReturn = state.priorSeasonReturnLeagues.length > 2;

  function handleSave() {
    const undecidedLeague = state.priorSeasonReturnLeagues.find(
      (league) => !state.selections.some((selection) => selection.leagueId === league.id),
    );
    if (undecidedLeague) {
      state.setError('Choose whether to return, extend sabbatical, or drop each prior league before saving.');
      return;
    }
    if (state.priorSeasonProtectedReturnCount > 2) {
      state.setError('You can protect at most two league spots. Choose subject-to-availability return for any additional leagues.');
      return;
    }
    const rosterMessage = byotWaitlistRosterValidationMessage(state, memberOptionById, memberOptionIdByName);
    if (rosterMessage) {
      state.setError(rosterMessage);
      return;
    }
    void state.saveSelections(onSaved);
  }

  return (
    <EditModalShell
      isOpen={isOpen}
      title={title}
      onClose={onClose}
      saving={state.saving}
      error={state.error}
      onSave={handleSave}
    >
      {state.loading ? (
        <InlineStateMessage title="Loading league choices" description="Checking guaranteed return spots." />
      ) : state.priorSeasonReturnLeagues.length === 0 ? (
        <InlineStateMessage
          tone="warning"
          title="No prior league spots"
          description="This registration does not include returning-league choices to edit here."
        />
      ) : (
        <div className="space-y-5">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Update return, sabbatical extension, and drop choices for prior-season leagues and continuing sabbaticals.
          </p>
          {(state.leaguePayload?.continuingSabbaticals?.length ?? 0) > 0 ? (
            <InlineStateMessage
              tone="neutral"
              title="Continuing sabbaticals"
              description="This curler can return this session, extend the sabbatical for a fee, or release the protected spot."
            />
          ) : null}
          {showsAvailabilityReturn ? (
            <InlineStateMessage
              tone="neutral"
              title="More than two prior leagues"
              description="A curler can protect up to two prior league spots. Additional leagues can be requested subject to availability."
            />
          ) : null}
          {state.priorSeasonReturnLeagues.map((league) => {
            const currentSelection = state.selections.find((selection) => selection.leagueId === league.id);
            const value = priorLeagueChoiceValue(currentSelection);
            const selectedProtected = currentSelection
              ? PROTECTED_RETURN_SELECTION_TYPES.has(currentSelection.selectionType)
              : false;
            const protectedLimitReached = state.priorSeasonProtectedReturnCount >= 2 && !selectedProtected;
            const continuingSabbatical = continuingSabbaticalForLeague(state.leaguePayload, league.id);
            const sabbaticalFeeLabel = continuingSabbatical
              ? formatCurrency(continuingSabbatical.sabbaticalFeeMinor)
              : null;
            return (
              <FormField key={league.id} label={league.name} htmlFor={`edit-prior-league-${league.id}`} required>
                {continuingSabbatical ? (
                  <p className="mb-2 text-xs text-amber-800 dark:text-amber-200">
                    Currently on sabbatical since{' '}
                    {new Date(`${continuingSabbatical.firstSabbaticalStartDate}T00:00:00`).toLocaleDateString()}.
                  </p>
                ) : null}
                <ChoiceInput
                  inputId={`edit-prior-league-${league.id}`}
                  layout="block"
                  value={value}
                  onChange={(next) =>
                    state.setSelections((current) =>
                      updateLeagueSelection(current, league.id, (next ?? 'none') as RegistrationSelectionType | 'none'),
                    )
                  }
                  options={[
                    {
                      value: 'guaranteed_return',
                      label: continuingSabbatical
                        ? 'Return to league this session'
                        : showsAvailabilityReturn
                          ? 'Return to league (guaranteed)'
                          : 'Return to league',
                      description: protectedLimitReached
                        ? 'You have already selected two protected league spots.'
                        : continuingSabbatical
                          ? 'End the sabbatical and play in this league this session.'
                          : 'Claim this guaranteed return spot.',
                      disabled: protectedLimitReached,
                    },
                    ...(!continuingSabbatical && showsAvailabilityReturn
                      ? [
                          {
                            value: 'return_subject_to_availability',
                            label: 'Attempt to return to the league (subject to availability)',
                            description: 'Request this league without using one of the two guaranteed return spots.',
                          },
                        ]
                      : []),
                    ...(league.allowsSabbatical
                      ? [
                          {
                            value: 'sabbatical',
                            label: continuingSabbatical ? 'Extend sabbatical' : 'Take a sabbatical for the league',
                            description: continuingSabbatical
                              ? continuingSabbatical.canExtend
                                ? `Remain on sabbatical for this session. Sabbatical fee: ${sabbaticalFeeLabel}.`
                                : continuingSabbatical.extensionBlockedMessage ??
                                  'The sabbatical duration limit has been reached.'
                              : protectedLimitReached
                                ? 'Sabbaticals also count toward the two protected league spots.'
                                : 'Preserve the spot while stepping away for this session.',
                            disabled:
                              protectedLimitReached ||
                              Boolean(continuingSabbatical && !continuingSabbatical.canExtend),
                          },
                        ]
                      : []),
                    {
                      value: 'drop',
                      label: continuingSabbatical ? 'Release protected spot' : 'Drop the league',
                      description: continuingSabbatical
                        ? 'Permanently release this sabbatical-protected spot.'
                        : 'Release this guaranteed return spot.',
                    },
                  ]}
                />
              </FormField>
            );
          })}
        </div>
      )}
    </EditModalShell>
  );
}

function WaitlistEditModal({
  registrationId,
  isOpen,
  onClose,
  onSaved,
  finalizeEdits,
}: SharedEditProps) {
  const state = useLeagueEditState(registrationId, isOpen, finalizeEdits);
  const { memberOptionById, memberOptionIdByName } = useRegistrationMemberMaps(isOpen);
  const [replacementWaitlistLeagueId, setReplacementWaitlistLeagueId] = useState<number | null>(null);
  const [placementOptionsByLeagueId, setPlacementOptionsByLeagueId] = useState<
    Record<number, Record<number, WaitlistTeamMemberPlacementOptions>>
  >({});
  const addWaitlistInputId = useId();

  const visibleWaitlistSelections = state.selections
    .filter(
      (selection) =>
        selection.leagueId != null &&
        (selection.selectionType === 'waitlist_add' || selection.selectionType === 'waitlist_replace'),
    )
    .sort(
      (a, b) =>
        (state.leagueCatalogOrder.get(a.leagueId as number) ?? Number.MAX_SAFE_INTEGER) -
        (state.leagueCatalogOrder.get(b.leagueId as number) ?? Number.MAX_SAFE_INTEGER),
    );

  const replaceWaitlistLeagueOptions = state.waitlistEligibleLeagues
    .filter((league) => !state.selectedLeagueIds.has(league.id))
    .map((league) => ({
      value: league.id,
      label: league.name,
      description: waitlistJoinOptionDescription(league, leagueScheduleText(league)),
    }));

  const replacementLeagueOptions = state.scheduledLeagueSelections
    .filter((selection) => selection.leagueId != null)
    .map((selection) => ({
      value: selection.leagueId as number,
      label: state.leagueName(selection.leagueId),
      description: state.selectionLabel(selection),
    }));

  function handleSave() {
    const hasRealLeagueSelection = state.selections.some(
      (selection) => selection.leagueId != null && REAL_LEAGUE_SELECTION_TYPES.has(selection.selectionType),
    );
    if (!hasRealLeagueSelection && visibleWaitlistSelections.length === 0) {
      state.setError('Select at least one waitlist to save.');
      return;
    }
    const rosterMessage = byotWaitlistRosterValidationMessage(state, memberOptionById, memberOptionIdByName);
    if (rosterMessage) {
      state.setError(rosterMessage);
      return;
    }
    if (requiresWaitlistFulfillmentPreferences(state.selections)) {
      const remaining = remainingFirstTwoLeagueSlots(state.leaguePayload?.activeLeagueIds ?? [], state.selections);
      const resolvedCount = remaining <= 1 ? 1 : state.desiredAddWaitlistLeagueCount;
      if (resolvedCount == null) {
        state.setError('Choose how many waitlist leagues to accept if multiple spots open.');
        return;
      }
      if (state.addWaitlistPriority.length < 2) {
        state.setError('Rank each ADD waitlist in priority order.');
        return;
      }
    }
    void state.saveSelections(onSaved);
  }

  return (
    <EditModalShell
      isOpen={isOpen}
      title="Edit waitlists"
      onClose={onClose}
      saving={state.saving}
      error={state.error}
      onSave={handleSave}
    >
      {state.loading ? (
        <InlineStateMessage title="Loading waitlists" description="Gathering current waitlist choices." />
      ) : (
        <div className="space-y-5">
          {(state.leaguePayload?.existingWaitlistEntries?.length ?? 0) > 0 ? (
            <InlineStateMessage
              tone="neutral"
              title="Existing waitlist positions"
              description={(state.leaguePayload?.existingWaitlistEntries ?? [])
                .map(
                  (entry) =>
                    `${state.leagueName(entry.leagueId)} · ${entry.entryType === 'replace' ? 'REPLACE' : 'ADD'}${
                      entry.replacesLeagueId ? ` (would replace ${state.leagueName(entry.replacesLeagueId)})` : ''
                    }`,
                )
                .join(' · ')}
            />
          ) : null}

          {visibleWaitlistSelections.length === 0 ? (
            <p className="text-sm text-gray-600 dark:text-gray-300">No waitlist selections are listed yet.</p>
          ) : (
            visibleWaitlistSelections.map((selection) => {
              const league = state.leaguePayload?.leagues.find((item) => item.id === selection.leagueId);
              const inputId = `edit-waitlist-roster-${selection.leagueId}`;
              return (
                <div key={`waitlist-${selection.leagueId}-${selection.selectionType}`} className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{state.leagueName(selection.leagueId)}</p>
                      <p className="text-sm text-gray-600 dark:text-gray-300">
                        {selection.selectionType === 'waitlist_replace'
                          ? `Waitlist: REPLACE — would replace ${selection.replacesLeagueId ? state.leagueName(selection.replacesLeagueId) : 'a selected league'}`
                          : 'Waitlist: ADD'}
                        {(() => {
                          const league = state.leaguePayload?.leagues.find((item) => item.id === selection.leagueId);
                          const positionSuffix = formatWaitlistPositionSuffix({
                            isExisting: false,
                            activeWaitlistEntryCount: league?.activeWaitlistEntryCount,
                          });
                          return positionSuffix ? ` ${positionSuffix}` : '';
                        })()}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        selection.leagueId != null &&
                        state.setSelections((current) => updateLeagueSelection(current, selection.leagueId as number, 'none'))
                      }
                    >
                      Remove
                    </Button>
                  </div>
                  {league?.leagueType === 'bring_your_own_team' ? (
                    <RegistrationByotWaitlistFields
                      league={league}
                      selection={selection}
                      inputId={inputId}
                      registeringCurler={{
                        id: state.curler?.id ?? null,
                        name: state.curler?.name ?? 'Registering curler',
                      }}
                      memberOptionById={memberOptionById}
                      memberOptionIdByName={memberOptionIdByName}
                      placementOptionsByMemberId={placementOptionsByLeagueId[league.id] ?? {}}
                      onPlacementOptionsLoaded={(options) =>
                        setPlacementOptionsByLeagueId((current) => ({ ...current, [league.id]: options }))
                      }
                      onSelectionsChange={(updater) => state.setSelections(updater)}
                    />
                  ) : null}
                </div>
              );
            })
          )}

          <FormField label="Add a league waitlist" htmlFor={addWaitlistInputId}>
            <ChoiceInput
              inputId={addWaitlistInputId}
              layout="popover"
              value={replacementWaitlistLeagueId}
              onChange={(next) => {
                if (typeof next !== 'number') {
                  setReplacementWaitlistLeagueId(null);
                  return;
                }
                if (replacementLeagueOptions.length === 0) {
                  state.setSelections((current) => updateLeagueSelection(current, next, 'waitlist_add'));
                  setReplacementWaitlistLeagueId(null);
                  return;
                }
                setReplacementWaitlistLeagueId(next);
              }}
              options={replaceWaitlistLeagueOptions}
              emptyText="No waitlist-eligible leagues remain."
            />
          </FormField>

          {replacementWaitlistLeagueId !== null && replacementLeagueOptions.length > 0 ? (
            <FormField label="League to replace" htmlFor="edit-replace-waitlist-target" required>
              <ChoiceInput
                inputId="edit-replace-waitlist-target"
                layout="block"
                value={null}
                onChange={(next) => {
                  if (replacementWaitlistLeagueId === null || typeof next !== 'number') return;
                  state.setSelections((current) => updateWaitlistReplaceSelection(current, replacementWaitlistLeagueId, next));
                  setReplacementWaitlistLeagueId(null);
                }}
                options={replacementLeagueOptions}
              />
            </FormField>
          ) : null}

          <RegistrationWaitlistFulfillmentFields
            selections={state.selections}
            activeLeagueIds={state.leaguePayload?.activeLeagueIds ?? []}
            desiredAddWaitlistLeagueCount={state.desiredAddWaitlistLeagueCount}
            addWaitlistPriority={state.addWaitlistPriority}
            leagueName={state.leagueName}
            tone="app"
            onDesiredCountChange={state.setDesiredAddWaitlistLeagueCount}
            onPriorityChange={(nextPriority) => {
              state.setAddWaitlistPriority(nextPriority);
              state.setSelections((current) => applyAddWaitlistPriorityOrder(current, nextPriority));
            }}
          />
        </div>
      )}
    </EditModalShell>
  );
}

function ThirdLeagueEditModal({
  registrationId,
  isOpen,
  onClose,
  onSaved,
  finalizeEdits,
}: SharedEditProps) {
  const state = useLeagueEditState(registrationId, isOpen, finalizeEdits);
  const thirdLeagueInputId = useId();
  const leagueEligibilityInput: LeagueEligibilityInput = {
    dateOfBirth: state.curler?.dateOfBirth,
    experienceType: state.membership?.selection.experienceType ?? 'none_or_minimal',
    experienceSelfReportedYears: state.membership?.selection.experienceSelfReportedYears,
    knownExperienceYears: state.membership?.knownExperienceYears,
    membershipOption: state.membership?.selection.membershipOption,
  };
  const thirdLeagueInterestOptions = (state.leaguePayload?.leagues ?? [])
    .filter((league) => isThirdLeagueInterestEligibleLeague(league, leagueEligibilityInput))
    .map((league) => ({ value: league.id, label: league.name }));
  const eligibleThirdLeagueIds = new Set(thirdLeagueInterestOptions.map((option) => option.value));
  const thirdLeagueSelectedIds = state.selections
    .filter(
      (selection) =>
        isThirdLeagueInterestSelection(selection) &&
        selection.leagueId != null &&
        eligibleThirdLeagueIds.has(selection.leagueId),
    )
    .map((selection) => selection.leagueId as number);

  return (
    <EditModalShell
      isOpen={isOpen}
      title="Edit third-league interest"
      onClose={onClose}
      saving={state.saving}
      error={state.error}
      onSave={() => void state.saveSelections(onSaved)}
    >
      {state.loading ? (
        <InlineStateMessage title="Loading third-league options" description="Gathering eligible leagues." />
      ) : thirdLeagueInterestOptions.length === 0 ? (
        <InlineStateMessage
          tone="warning"
          title="No eligible leagues"
          description="There are no additional standard leagues available for this curler's age and experience path."
        />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            These choices tell staff which additional standard leagues would be suitable if third-league spots are available. They are not waitlist entries.
          </p>
          <ChoiceInput
            inputId={thirdLeagueInputId}
            layout="block"
            maxSelectedItems={null}
            multiSelectionIndicatorStyle="checkboxes"
            ariaLabel="Third-league interest"
            value={thirdLeagueSelectedIds}
            onChange={(nextValue) => {
              const selected = Array.isArray(nextValue) ? nextValue : nextValue != null ? [nextValue] : [];
              state.setSelections((current) =>
                setThirdLeagueInterestSelections(
                  current,
                  selected.filter((id): id is number => typeof id === 'number'),
                  state.priorSeasonReturnLeagueIds,
                ),
              );
            }}
            options={thirdLeagueInterestOptions}
          />
        </div>
      )}
    </EditModalShell>
  );
}

function ByotEditModal({
  registrationId,
  isOpen,
  onClose,
  onSaved,
  finalizeEdits,
}: SharedEditProps) {
  const state = useLeagueEditState(registrationId, isOpen, finalizeEdits);
  const { memberOptionById, memberOptionIdByName } = useRegistrationMemberMaps(isOpen);
  const byotLeagues = (state.leaguePayload?.leagues ?? []).filter((league) => league.leagueType === 'bring_your_own_team');

  function handleSave() {
    const rosterMessage = byotWaitlistRosterValidationMessage(state, memberOptionById, memberOptionIdByName);
    if (rosterMessage) {
      state.setError(rosterMessage);
      return;
    }
    void state.saveSelections(onSaved);
  }

  return (
    <EditModalShell
      isOpen={isOpen}
      title="Edit BYOT requests"
      onClose={onClose}
      saving={state.saving}
      error={state.error}
      onSave={handleSave}
    >
      {state.loading ? (
        <InlineStateMessage title="Loading BYOT leagues" description="Gathering bring-your-own-team options." />
      ) : byotLeagues.length === 0 ? (
        <InlineStateMessage tone="warning" title="No BYOT leagues" description="There are no BYOT leagues configured for this session." />
      ) : (
        <div className="space-y-5">
          {byotLeagues.map((league) => {
            const currentSelection = state.selections.find((selection) => selection.leagueId === league.id);
            const value = currentSelection?.selectionType === 'byot_request' ? 'byot_request' : 'none';
            return (
              <div key={league.id} className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <FormField label={league.name} htmlFor={`edit-byot-${league.id}`}>
                  <ChoiceInput
                    inputId={`edit-byot-${league.id}`}
                    layout="block"
                    value={value}
                    onChange={(next) =>
                      state.setSelections((current) =>
                        updateLeagueSelection(
                          current,
                          league.id,
                          next === 'byot_request' ? 'byot_request' : 'none',
                        ),
                      )
                    }
                    options={[
                      { value: 'none', label: 'No BYOT request' },
                      { value: 'byot_request', label: 'BYOT request', description: 'List teammates for coordinator review.' },
                    ]}
                  />
                </FormField>
                {currentSelection?.selectionType === 'byot_request' ? (
                  <FormField label="Teammates" htmlFor={`edit-byot-teammates-${league.id}`} required>
                    <textarea
                      id={`edit-byot-teammates-${league.id}`}
                      className="app-input min-h-24"
                      value={currentSelection.byotTeammateText ?? ''}
                      onChange={(event) =>
                        state.setSelections((current) => updateByotTeammates(current, league.id, event.target.value))
                      }
                      placeholder="List teammate names"
                    />
                  </FormField>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </EditModalShell>
  );
}

type StaffSavePromptInput = {
  onSaved: () => void | Promise<void>;
  setSaving: (saving: boolean) => void;
  setError: (error: string | null) => void;
};

type StaffEmailOptions = {
  sendEmail: boolean;
  changeSummary: string;
};

type RegistrationViewEditModalsProps = {
  registrationId: number | null;
  activeModal: RegistrationEditModalKind;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  staffMode?: boolean;
  registrationWindow?: { seasonId: number; sessionId: number };
  onStaffPaymentAdjustment?: (result: SubmitRegistrationEditsResult) => void;
};

export default function RegistrationViewEditModals({
  registrationId,
  activeModal,
  onClose,
  onSaved,
  staffMode = false,
  onStaffPaymentAdjustment,
}: RegistrationViewEditModalsProps) {
  const staffChangeSummaryFieldId = useId();
  const [checkoutConfirmation, setCheckoutConfirmation] = useState<SubmitRegistrationEditsResult | null>(null);
  const [confirmingCheckout, setConfirmingCheckout] = useState(false);
  const [staffSavePrompt, setStaffSavePrompt] = useState<StaffSavePromptInput | null>(null);
  const [staffSendEmail, setStaffSendEmail] = useState(true);
  const [staffChangeSummary, setStaffChangeSummary] = useState('');
  const [staffSavePromptError, setStaffSavePromptError] = useState<string | null>(null);
  const [staffSavePromptSaving, setStaffSavePromptSaving] = useState(false);
  const [staffEmailOptions, setStaffEmailOptions] = useState<StaffEmailOptions | null>(null);

  const runStaffSubmit = useCallback(
    async (
      input: StaffSavePromptInput,
      emailOptions: StaffEmailOptions,
      options: { confirmImmediatePayment?: boolean } = {},
    ) => {
      if (registrationId == null) return;
      input.setSaving(true);
      input.setError(null);
      setStaffSavePromptSaving(true);
      setStaffSavePromptError(null);
      try {
        const result = await submitStaffRegistrationEdits(registrationId, {
          confirmImmediatePayment: options.confirmImmediatePayment,
          changedSummary: emailOptions.sendEmail ? emailOptions.changeSummary : undefined,
        });
        if (result.requiresCheckoutConfirmation) {
          setStaffSavePrompt(null);
          setCheckoutConfirmation(result);
          return;
        }
        setStaffEmailOptions(null);
        setStaffSavePrompt(null);
        if (result.paymentAdjustment) {
          onStaffPaymentAdjustment?.(result);
        }
        await input.onSaved();
      } catch (err) {
        setStaffSavePromptError(editValidationErrorMessage(err, 'Unable to save registration changes.'));
      } finally {
        input.setSaving(false);
        setStaffSavePromptSaving(false);
      }
    },
    [registrationId, onStaffPaymentAdjustment],
  );

  const finalizeEdits = useCallback(
    async (input: {
      evaluation?: RegistrationLeagueEvaluation | RegistrationMembershipPaymentPayload;
      onSaved: () => void | Promise<void>;
      setSaving: (saving: boolean) => void;
      setError: (error: string | null) => void;
    }) => {
      if (registrationId == null) return;
      if (staffMode) {
        input.setSaving(false);
        setStaffSendEmail(true);
        setStaffChangeSummary('');
        setStaffSavePromptError(null);
        setStaffSavePrompt({
          onSaved: input.onSaved,
          setSaving: input.setSaving,
          setError: input.setError,
        });
        return;
      }
      input.setSaving(true);
      input.setError(null);
      try {
        const result = await submitRegistrationEdits(registrationId);
        if (result.requiresCheckoutConfirmation) {
          setCheckoutConfirmation(result);
          return;
        }
        if (result.checkoutUrl) {
          window.location.assign(result.checkoutUrl);
          return;
        }
        await input.onSaved();
      } catch (err) {
        input.setError(editValidationErrorMessage(err, 'Unable to save registration changes.'));
      } finally {
        input.setSaving(false);
      }
    },
    [registrationId, staffMode],
  );

  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  function handleStaffSavePromptConfirm() {
    if (!staffSavePrompt) return;
    if (staffSendEmail && !staffChangeSummary.trim()) {
      setStaffSavePromptError('Enter a change summary to include in the email.');
      return;
    }
    const emailOptions: StaffEmailOptions = {
      sendEmail: staffSendEmail,
      changeSummary: staffChangeSummary.trim(),
    };
    setStaffEmailOptions(emailOptions);
    void runStaffSubmit(staffSavePrompt, emailOptions);
  }

  function handleStaffSavePromptCancel() {
    setStaffSavePrompt(null);
    setStaffSavePromptError(null);
  }

  async function handleConfirmCheckout() {
    if (registrationId == null) return;
    setConfirmingCheckout(true);
    setCheckoutError(null);
    try {
      const result = staffMode
        ? await submitStaffRegistrationEdits(registrationId, {
            confirmImmediatePayment: true,
            changedSummary: staffEmailOptions?.sendEmail ? staffEmailOptions.changeSummary : undefined,
          })
        : await submitRegistrationEdits(registrationId, { confirmImmediatePayment: true });
      if (result.paymentAdjustment) {
        onStaffPaymentAdjustment?.(result);
      }
      if (result.checkoutUrl && !staffMode) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      setStaffEmailOptions(null);
      setCheckoutConfirmation(null);
      await onSaved();
    } catch (err) {
      setCheckoutError(editValidationErrorMessage(err, 'Unable to start checkout.'));
    } finally {
      setConfirmingCheckout(false);
    }
  }

  if (registrationId == null) return null;

  const shared = { registrationId, onClose, onSaved, finalizeEdits };

  return (
    <>
      <MembershipEditModal {...shared} isOpen={activeModal === 'membership'} />
      <PriorLeagueEditModal {...shared} title="Edit confirmed leagues" isOpen={activeModal === 'confirmedLeagues'} />
      <PriorLeagueEditModal {...shared} title="Edit sabbaticals" isOpen={activeModal === 'sabbaticals'} />
      <WaitlistEditModal {...shared} isOpen={activeModal === 'waitlists'} />
      <ThirdLeagueEditModal {...shared} isOpen={activeModal === 'thirdLeague'} />
      <ByotEditModal {...shared} isOpen={activeModal === 'byot'} />
      <Modal
        isOpen={staffSavePrompt != null}
        onClose={handleStaffSavePromptCancel}
        title="Save registration changes"
        size="md"
      >
        <div className="space-y-4">
          <FormCheckbox
            label="Send an email confirmation to the member?"
            checked={staffSendEmail}
            onChange={setStaffSendEmail}
            disabled={staffSavePromptSaving}
          />
          {staffSendEmail ? (
            <FormField label="Change summary" htmlFor={staffChangeSummaryFieldId} required>
              <textarea
                id={staffChangeSummaryFieldId}
                className="app-input min-h-24"
                value={staffChangeSummary}
                onChange={(event) => setStaffChangeSummary(event.target.value)}
                placeholder="Describe what changed and why."
                disabled={staffSavePromptSaving}
              />
            </FormField>
          ) : null}
          {staffSavePromptError ? <InlineStateMessage tone="error" title={staffSavePromptError} /> : null}
          <div className="flex flex-wrap justify-end gap-3 border-t border-gray-200 pt-4 dark:border-gray-700">
            <Button
              type="button"
              variant="secondary"
              disabled={staffSavePromptSaving}
              onClick={handleStaffSavePromptCancel}
            >
              Cancel
            </Button>
            <Button type="button" disabled={staffSavePromptSaving} onClick={handleStaffSavePromptConfirm}>
              {staffSavePromptSaving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      </Modal>
      <RegistrationImmediatePaymentConfirmationModal
        isOpen={checkoutConfirmation != null}
        saving={confirmingCheckout}
        message={checkoutConfirmation?.message}
        error={checkoutError}
        onCancel={() => {
          setStaffEmailOptions(null);
          setCheckoutConfirmation(null);
          setCheckoutError(null);
        }}
        onContinue={() => void handleConfirmCheckout()}
      />
    </>
  );
}
