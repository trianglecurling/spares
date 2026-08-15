import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import api from '../../utils/api';
import Button from '../Button';
import ChoiceInput from '../ChoiceInput';
import FormCheckbox from '../FormCheckbox';
import FormField from '../FormField';
import InlineStateMessage from '../InlineStateMessage';
import Modal from '../Modal';
import RegistrationImmediatePaymentConfirmationModal from './RegistrationImmediatePaymentConfirmationModal';
import LeaguePriorityStep from './LeaguePriorityStep';
import type {
  LeaguePrioritySavePayload,
  RegistrationLeagueCatalogPayload,
} from './leaguePriorityShared';
import {
  editValidationErrorMessage,
  hasClubExperienceRecord,
  isJuniorRecreationalEligibleDate,
  loadMembershipEditContext,
  loadRegistrationEditContext,
  registrationDiscountLabel,
  saveLeaguePriorities,
  submitRegistrationEdits,
  submitStaffRegistrationEdits,
  type IcePrivilegesChoice,
  type LeagueEligibilityInput,
  type RegistrationLeagueEvaluation,
  type RegistrationMembershipPaymentPayload,
  type RegistrationShellCurler,
  type RegistrationWindow,
  type SubmitRegistrationEditsResult,
} from './registrationViewEditShared';

export type RegistrationEditModalKind = 'membership' | 'leaguePriority' | null;

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
    let canceled = false;
    setLoading(true);
    setError(null);
    void loadMembershipEditContext(registrationId)
      .then((context) => {
        if (canceled) return;
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
        if (!canceled) setError(editValidationErrorMessage(err, 'Unable to load membership details.'));
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
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
        description: 'Choose this special junior program. It skips normal league selection. For Junior Advanced Commitment, please select "Regular membership".',
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
              description="Social members do not receive ice privileges."
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
                      label: 'League play or instructional programs',
                      description: 'Evening and weekend leagues. Includes Saturday Instructional and Junior Advanced Commitment programs.',
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

/**
 * The whole league side of a registration is one ordered list now, so editing it
 * reuses the same step component the registration wizard renders.
 */
function LeaguePriorityEditModal({ registrationId, isOpen, onClose, onSaved, finalizeEdits }: SharedEditProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaguePayload, setLeaguePayload] = useState<RegistrationLeagueCatalogPayload | null>(null);
  const [curler, setCurler] = useState<RegistrationShellCurler | null>(null);
  const [membership, setMembership] = useState<RegistrationMembershipPaymentPayload | null>(null);
  const [windowState, setWindowState] = useState<RegistrationWindow | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let canceled = false;
    setLoading(true);
    setError(null);
    void loadRegistrationEditContext(registrationId)
      .then((context) => {
        if (canceled) return;
        setLeaguePayload(context.league);
        setCurler(context.curler);
        setMembership(context.membership);
        setWindowState(context.window);
      })
      .catch((err) => {
        if (!canceled) setError(editValidationErrorMessage(err, 'Unable to load league choices.'));
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [isOpen, registrationId]);

  const eligibility: LeagueEligibilityInput = {
    dateOfBirth: curler?.dateOfBirth,
    experienceType: membership?.selection.experienceType ?? 'none_or_minimal',
    experienceSelfReportedYears: membership?.selection.experienceSelfReportedYears,
    knownExperienceYears: membership?.knownExperienceYears,
    membershipOption: membership?.selection.membershipOption,
  };

  const save = async (input: LeaguePrioritySavePayload) => {
    setSaving(true);
    setError(null);
    try {
      const data = await saveLeaguePriorities(registrationId, input);
      setLeaguePayload(data);
      await finalizeEdits({ evaluation: data.evaluation, onSaved, setSaving, setError });
    } catch (err) {
      const message = editValidationErrorMessage(err, 'Unable to save league choices.');
      setError(message);
      setSaving(false);
      throw new Error(message);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        membership?.selection.membershipOption === 'none' || membership?.selection.membershipOption === 'social'
          ? 'Edit sabbaticals'
          : 'Edit league priorities'
      }
      size="lg"
      verticalAlign="start"
    >
      <div className="space-y-4">
        {loading ? (
          <InlineStateMessage title="Loading league choices..." />
        ) : (
          <LeaguePriorityStep
            payload={leaguePayload}
            eligibility={eligibility}
            registeringCurler={{ id: curler?.id ?? null, name: curler?.name ?? 'Registering curler' }}
            saving={saving}
            continueLabel={saving ? 'Saving…' : 'Save changes'}
            restrictToFreeLeagues={
              membership?.selection.membershipOption !== 'none' &&
              membership?.selection.membershipOption !== 'social' &&
              (membership?.icePrivilegesChoice === 'basic_ice' ||
                membership?.selection.membershipOption === 'regular_spare_only')
            }
            sabbaticalOnly={
              membership?.selection.membershipOption === 'none' ||
              membership?.selection.membershipOption === 'social'
            }
            registrationState={leaguePayload?.registrationState ?? windowState?.state}
            discountClaims={{
              studentDiscountClaimed: membership?.selection.studentDiscountClaimed ?? false,
              reciprocalDiscountClaimed: membership?.selection.reciprocalDiscountClaimed ?? false,
              availableDiscounts: windowState?.availableDiscounts,
            }}
            onSave={save}
          />
        )}
        {error ? <InlineStateMessage tone="error" title={error} /> : null}
        <div className="flex flex-wrap justify-end gap-3 border-t border-gray-200 pt-4 dark:border-gray-700">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
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
      <LeaguePriorityEditModal {...shared} isOpen={activeModal === 'leaguePriority'} />
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
