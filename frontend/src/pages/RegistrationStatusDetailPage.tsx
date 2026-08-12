import { useNavigate, useParams } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { AppPage, AppPageHeader } from '../components/AppPage';
import AppStateCard from '../components/AppStateCard';
import Button from '../components/Button';
import RegistrationViewEditModals, {
  type RegistrationEditModalKind,
} from '../components/registration/RegistrationViewEditModals';
import type { RegistrationPlayInEntrySummary } from '../components/registration/registrationViewEditShared';
import {
  guaranteeChipClassName,
  guaranteeChipLabel,
  shouldShowGuaranteeChip,
  type LeaguePriorityGuaranteeLabel,
} from '../components/registration/leaguePriorityShared';
import { playInEntryTeamMembersText } from '../components/registration/RegistrationPlayInEntryPanel';
import { useAlert } from '../contexts/AlertContext';
import { useConfirm } from '../contexts/ConfirmContext';
import api, { getApiErrorMessage } from '../utils/api';

type Selection = {
  id: number;
  selectionType: string;
  status: string;
  leagueId: number | null;
  leagueName: string | null;
};

type LeaguePriority = {
  id: number;
  leagueId: number;
  leagueName: string;
  priorityRank: number;
  guaranteeLabel: LeaguePriorityGuaranteeLabel | null;
  byotTeammateText: string | null;
  teamRosterDisplay?: string | null;
};

type WaitlistEntry = {
  id: number;
  waitlistId: number;
  waitlistName: string;
  leagueId: number;
  leagueName: string;
  priorityRank: number | null;
  desiredLeagueCount: number | null;
  declineCount: number;
  position: number | null;
  rolledOverFromWaitlistEntryId: number | null;
  isPrimaryMember?: boolean;
  canRemoveSelf?: boolean;
  primaryMemberName?: string | null;
  teammateContactMessage?: string | null;
  teamRosterDisplay?: string | null;
};

type Communication = {
  id: number;
  messageType: string;
  recipientEmail: string;
  subject: string;
  deliveryStatus: string;
  sentAt: string | null;
  createdAt: string;
};

type RegistrationDetail = {
  registration: {
    id: number;
    curlerName: string;
    seasonName: string | null;
    sessionName: string | null;
    registrationStatus: string;
    membershipOption: string;
    studentDiscountClaimed: boolean;
    reciprocalDiscountClaimed: boolean;
    membershipCommitteeComments: string | null;
    submittedAt: string | null;
    updatedAt: string | null;
  };
  selections: Selection[];
  priorities: LeaguePriority[];
  desiredLeagueCount: number | null;
  playInEntry?: Record<number, RegistrationPlayInEntrySummary>;
  waitlists: WaitlistEntry[];
  payment: {
    status: string;
    amountDueMinor: number | null;
    amountPaidMinor: number | null;
    paymentLink: string | null;
    deferredReason: string | null;
  };
  communications: Communication[];
  canEditDuringPriority: boolean;
  canCancelDuringPriority: boolean;
};

function label(value: string | null | undefined) {
  if (!value) return 'Not available';
  if (value === 'cancelled') return 'Canceled';
  return value.replace(/_/g, ' ');
}

function money(minor: number | null) {
  if (minor == null) return 'Not available';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minor / 100);
}

function Section({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="app-card space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h2 className="app-section-title">{title}</h2>
        {onEdit ? (
          <Button type="button" variant="secondary" onClick={onEdit}>
            Edit
          </Button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export default function RegistrationStatusDetailPage() {
  const navigate = useNavigate();
  const { slot: slotParam } = useParams();
  const viewSlot = Number(slotParam);
  const hasValidViewSlot = Number.isInteger(viewSlot) && viewSlot > 0;
  const { confirm } = useConfirm();
  const { showAlert } = useAlert();
  const [detail, setDetail] = useState<RegistrationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [activeEditModal, setActiveEditModal] = useState<RegistrationEditModalKind>(null);

  const load = useCallback(async () => {
    if (!hasValidViewSlot) {
      setDetail(null);
      setError('This registration link is invalid.');
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await api.get<RegistrationDetail>('/registration/member/registrations/current', {
        params: { slot: viewSlot },
      });
      setDetail(response.data);
      setError(null);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Unable to load registration.'));
    } finally {
      setLoading(false);
    }
  }, [hasValidViewSlot, viewSlot]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleEditSaved() {
    setActiveEditModal(null);
    showAlert('Your registration has been updated.', 'success', 'Changes saved');
    await load();
  }

  async function removeWaitlist(entry: WaitlistEntry) {
    const ok = await confirm({
      title: 'Remove from waitlist?',
      message: `Are you sure you want to remove yourself from the waitlist for ${entry.waitlistName || entry.leagueName}?\n\nYou will give up your current waitlist position. If you join this waitlist again later, you will be added as a new entry.`,
      confirmText: 'Remove from waitlist',
      cancelText: 'Keep my position',
      variant: 'warning',
    });
    if (!ok) return;
    try {
      await api.post(`/registration/member/waitlist-entries/${entry.id}/remove`, {});
      showAlert('You have been removed from the waitlist.', 'success', 'Waitlist updated');
      await load();
    } catch (err) {
      showAlert(getApiErrorMessage(err, 'Unable to remove waitlist entry.'), 'error', 'Waitlist update failed');
    }
  }

  async function cancelRegistration() {
    const ok = await confirm({
      title: 'Cancel registration?',
      message:
        'Are you sure you want to cancel your registration? If you have already paid, you will receive a refund, and you will not be placed into any leagues.',
      confirmText: 'Cancel registration',
      cancelText: 'Keep registration',
      variant: 'danger',
    });
    if (!ok) return;

    setDeleting(true);
    try {
      const response = await api.post<{ refundIssued: boolean }>('/registration/member/registrations/current/cancel', undefined, {
        params: hasValidViewSlot ? { slot: viewSlot } : undefined,
      });
      showAlert(
        response.data.refundIssued
          ? 'Your registration has been canceled and a refund has been issued.'
          : 'Your registration has been canceled.',
        'success',
        'Registration canceled',
      );
      navigate('/dashboard', { replace: true });
    } catch (err) {
      showAlert(getApiErrorMessage(err, 'Unable to cancel registration.'), 'error', 'Cancel failed');
    } finally {
      setDeleting(false);
    }
  }

  const isJuniorRecreational = detail?.registration.membershipOption === 'junior_recreational';
  const priorities = detail?.priorities ?? [];
  const sabbaticals = detail?.selections.filter((selection) => selection.selectionType === 'sabbatical') ?? [];
  const drops = detail?.selections.filter((selection) => selection.selectionType === 'drop') ?? [];
  const waitlistByLeagueId = new Map((detail?.waitlists ?? []).map((entry) => [entry.leagueId, entry]));
  const canEdit = detail?.canEditDuringPriority ?? false;
  const canCancel = detail?.canCancelDuringPriority ?? false;
  const isPaidRegistration = ['paid', 'confirmed'].includes(detail?.registration.registrationStatus ?? '');
  const deferredPaymentMessage = isJuniorRecreational
    ? detail?.payment.deferredReason?.includes('junior_financial_assistance_requires_review')
      ? 'You do not need to pay yet. Junior Recreational financial assistance is under staff review.'
      : 'You do not need to pay yet. We will contact you when payment is ready.'
    : 'You do not need to pay yet. Some choices require placement or staff review first.';

  return (
    <>
      <AppPage>
        <AppPageHeader
          title={detail ? `Registration for ${detail.registration.curlerName}` : 'Registration details'}
          description={detail ? `${detail.registration.seasonName ?? 'Season'} / ${detail.registration.sessionName ?? 'Session'}` : undefined}
          actions={
            canCancel ? (
              <Button type="button" variant="outline-danger" disabled={deleting} onClick={() => void cancelRegistration()}>
                Cancel registration
              </Button>
            ) : undefined
          }
        />

        {loading ? <AppStateCard title="Loading registration" description="Gathering the latest status." /> : null}
        {error ? <AppStateCard title="Unable to load registration" description={error} /> : null}

        {detail ? (
          <div className="grid gap-4">
            <Section
              title="Membership and payment"
              onEdit={canEdit ? () => setActiveEditModal('membership') : undefined}
            >
              <div className="grid gap-3 md:grid-cols-2">
                <p>Membership/program: {label(detail.registration.membershipOption)}</p>
                <p>Registration status: {label(detail.registration.registrationStatus)}</p>
                <p>Payment status: {label(detail.payment.status)}</p>
                <p>Amount due: {money(detail.payment.amountDueMinor)}</p>
              </div>
              {detail.registration.studentDiscountClaimed ? <p>Student discount claimed.</p> : null}
              {detail.registration.reciprocalDiscountClaimed ? <p>Reciprocal discount claimed.</p> : null}
              {detail.registration.membershipCommitteeComments ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-700 dark:bg-gray-900/40">
                  <p className="font-medium text-gray-900 dark:text-gray-100">Comments for the Membership Committee</p>
                  <p className="mt-1 whitespace-pre-wrap text-gray-700 dark:text-gray-300">
                    {detail.registration.membershipCommitteeComments}
                  </p>
                </div>
              ) : null}
              {isPaidRegistration && !canEdit && canCancel ? (
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Paid registrations cannot be edited. During priority registration, you can cancel this registration to receive a full refund and register again.
                </p>
              ) : null}
              {detail.payment.paymentLink ? (
                <a href={detail.payment.paymentLink}>
                  <Button>Pay now</Button>
                </a>
              ) : detail.payment.status === 'deferred' ? (
                <p className="text-sm text-gray-600 dark:text-gray-300">{deferredPaymentMessage}</p>
              ) : null}
            </Section>

            {isJuniorRecreational ? (
              <Section title="Junior Recreational program">
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Junior Recreational skips league priorities, waitlists, and sparing.
                  Program placement and scheduling are handled separately from standard league registration.
                </p>
              </Section>
            ) : (
              <>
                <Section
                  title="League priorities"
                  onEdit={canEdit ? () => setActiveEditModal('leaguePriority') : undefined}
                >
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    {detail.desiredLeagueCount
                      ? `You asked to play in ${detail.desiredLeagueCount} ${
                          detail.desiredLeagueCount === 1 ? 'league' : 'leagues'
                        }, listed here most wanted first.`
                      : 'Your leagues are listed most wanted first.'}
                  </p>
                  {priorities.length === 0 ? <p>No leagues are on your list yet.</p> : null}
                  {priorities.map((priority) => {
                    const playInSummary = detail.playInEntry?.[priority.leagueId];
                    const waitlistEntry = waitlistByLeagueId.get(priority.leagueId);
                    return (
                      <div key={priority.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">
                            {priority.priorityRank}. {priority.leagueName}
                          </p>
                          {shouldShowGuaranteeChip(priority.guaranteeLabel) ? (
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${guaranteeChipClassName(
                                priority.guaranteeLabel,
                              )}`}
                            >
                              {guaranteeChipLabel(priority.guaranteeLabel)}
                            </span>
                          ) : null}
                        </div>
                        {waitlistEntry ? (
                          <p className="text-sm text-gray-600 dark:text-gray-300">
                            Waitlist position {waitlistEntry.position ?? 'not available'} · Declines{' '}
                            {waitlistEntry.declineCount}
                          </p>
                        ) : null}
                        {playInSummary?.existingTeam ? (
                          <p className="text-sm text-gray-600 dark:text-gray-300">
                            Team: {playInEntryTeamMembersText(playInSummary.existingTeam)}
                          </p>
                        ) : priority.teamRosterDisplay ? (
                          <p className="text-sm text-gray-600 dark:text-gray-300">
                            Team roster: {priority.teamRosterDisplay}
                          </p>
                        ) : null}
                        {playInSummary && !playInSummary.guaranteed ? (
                          <p className="text-sm text-gray-600 dark:text-gray-300">
                            Play-in league. Your team plays for entry this session.
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </Section>

                <Section title="Sabbaticals and drops">
                  {sabbaticals.length === 0 && drops.length === 0 ? (
                    <p>No sabbaticals or drops are listed for this registration.</p>
                  ) : null}
                  {sabbaticals.map((selection) => (
                    <div key={selection.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                      <p className="font-medium">{selection.leagueName}</p>
                      <p className="text-sm text-gray-600 dark:text-gray-300">
                        Sabbatical. This preserves the curler’s return right under the sabbatical rules.
                        Sabbaticals are time-limited.
                      </p>
                    </div>
                  ))}
                  {drops.map((selection) => (
                    <div key={selection.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                      <p className="font-medium">{selection.leagueName}</p>
                      <p className="text-sm text-gray-600 dark:text-gray-300">
                        Dropped. The return right for this league has been given up.
                      </p>
                    </div>
                  ))}
                </Section>

                <Section title="Waitlists">
                  {detail.waitlists.length === 0 ? <p>No active waitlist entries are listed.</p> : null}
                  {detail.waitlists.map((entry) => (
                    <div key={entry.id} className="flex flex-col gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="font-medium">{entry.waitlistName || entry.leagueName}</p>
                        <p className="text-sm text-gray-600 dark:text-gray-300">
                          {entry.priorityRank ? `Priority ${entry.priorityRank} · ` : ''}
                          Position {entry.position ?? 'not available'} · Declines {entry.declineCount}
                          {entry.rolledOverFromWaitlistEntryId ? ' · Carried from a prior session entry' : ''}
                        </p>
                        {entry.teamRosterDisplay ? (
                          <p className="text-sm text-gray-600 dark:text-gray-300">
                            Team roster: {entry.teamRosterDisplay}
                          </p>
                        ) : null}
                      </div>
                      {entry.canRemoveSelf ? (
                        <Button variant="outline-danger" onClick={() => void removeWaitlist(entry)}>
                          Remove from waitlist
                        </Button>
                      ) : entry.teammateContactMessage ? (
                        <p className="text-sm text-gray-600 dark:text-gray-300 md:max-w-sm">{entry.teammateContactMessage}</p>
                      ) : null}
                    </div>
                  ))}
                </Section>
              </>
            )}

            <Section title="Communication history">
              {detail.communications.length === 0 ? <p>No registration communications have been logged yet.</p> : null}
              <div className="space-y-2">
                {detail.communications.map((communication) => (
                  <div key={communication.id} className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-800">
                    <p className="font-medium">{label(communication.messageType)}</p>
                    <p>{communication.recipientEmail} · {label(communication.deliveryStatus)}</p>
                  </div>
                ))}
              </div>
            </Section>

            <RegistrationViewEditModals
              registrationId={detail.registration.id}
              activeModal={activeEditModal}
              onClose={() => setActiveEditModal(null)}
              onSaved={handleEditSaved}
            />
          </div>
        ) : null}
      </AppPage>
    </>
  );
}
