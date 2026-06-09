import { useNavigate, useParams } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { AppPage, AppPageHeader } from '../components/AppPage';
import AppStateCard from '../components/AppStateCard';
import Button from '../components/Button';
import RegistrationViewEditModals, {
  type RegistrationEditModalKind,
} from '../components/registration/RegistrationViewEditModals';
import { isConfirmedLeaguePlacement, rosterTextDisplay } from '../components/registration/registrationViewEditShared';
import { useAlert } from '../contexts/AlertContext';
import { useConfirm } from '../contexts/ConfirmContext';
import api, { getApiErrorMessage } from '../utils/api';

type Selection = {
  id: number;
  selectionType: string;
  status: string;
  rank: number | null;
  leagueId: number | null;
  leagueName: string | null;
  replacesLeagueId: number | null;
  replacedLeagueName: string | null;
  isTemporarySabbaticalFill: number;
  byotTeammateText: string | null;
};

type WaitlistEntry = {
  id: number;
  waitlistId: number;
  waitlistName: string;
  leagueId: number;
  leagueName: string;
  entryType: 'add' | 'replace';
  replacesLeagueId: number | null;
  declineCount: number;
  position: number | null;
  rolledOverFromWaitlistEntryId: number | null;
  isPrimaryMember?: boolean;
  canRemoveSelf?: boolean;
  primaryMemberName?: string | null;
  teammateContactMessage?: string | null;
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
    submittedAt: string | null;
    updatedAt: string | null;
  };
  selections: Selection[];
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
  return value ? value.replace(/_/g, ' ') : 'Not available';
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

  const canEditPriorLeagueChoices =
    detail?.selections.some((selection) =>
      ['guaranteed_return', 'sabbatical', 'drop'].includes(selection.selectionType),
    ) ?? false;

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

  async function deleteRegistration() {
    const ok = await confirm({
      title: 'Delete registration?',
      message:
        'Are you sure you want to delete your registration? If you have already paid, you will receive a refund, and you will not be placed into any leagues.',
      confirmText: 'Delete registration',
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
          ? 'Your registration has been deleted and a refund has been issued.'
          : 'Your registration has been deleted.',
        'success',
        'Registration deleted',
      );
      navigate('/dashboard', { replace: true });
    } catch (err) {
      showAlert(getApiErrorMessage(err, 'Unable to delete registration.'), 'error', 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }

  const isJuniorRecreational = detail?.registration.membershipOption === 'junior_recreational';
  const confirmed = detail?.selections.filter(isConfirmedLeaguePlacement) ?? [];
  const playIns = detail?.selections.filter((selection) => selection.selectionType === 'play_in_request') ?? [];
  const thirdLeague =
    detail?.selections.filter((selection) =>
      ['third_league_interest', 'return_subject_to_availability'].includes(selection.selectionType),
    ) ?? [];
  const byot = detail?.selections.filter((selection) => selection.selectionType === 'byot_request') ?? [];
  const sabbaticals = detail?.selections.filter((selection) => selection.selectionType === 'sabbatical') ?? [];
  const canEdit = detail?.canEditDuringPriority ?? false;
  const canCancel = detail?.canCancelDuringPriority ?? false;
  const isPaidRegistration = ['paid', 'confirmed'].includes(detail?.registration.registrationStatus ?? '');
  const deferredPaymentMessage = isJuniorRecreational
    ? detail?.payment.deferredReason?.includes('junior_financial_assistance_requires_review')
      ? 'You do not need to pay yet. Junior Recreational financial assistance is under staff review.'
      : 'You do not need to pay yet. We will contact you when payment is ready.'
    : 'You do not need to pay yet. Some choices require placement or staff review first.';

  return (
    <Layout>
      <AppPage>
        <AppPageHeader
          title={detail ? `Registration for ${detail.registration.curlerName}` : 'Registration details'}
          description={detail ? `${detail.registration.seasonName ?? 'Season'} / ${detail.registration.sessionName ?? 'Session'}` : undefined}
          actions={
            canCancel ? (
              <Button type="button" variant="outline-danger" disabled={deleting} onClick={() => void deleteRegistration()}>
                Delete registration
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
              {isPaidRegistration && !canEdit && canCancel ? (
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Paid registrations cannot be edited. During priority registration, you can delete this registration to receive a full refund and register again.
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
                  Junior Recreational skips normal league selection, waitlists, sparing, and third-league interest.
                  Program placement and scheduling are handled separately from standard league registration.
                </p>
              </Section>
            ) : (
              <>
                <Section
                  title="Confirmed leagues"
                  onEdit={canEdit && canEditPriorLeagueChoices ? () => setActiveEditModal('confirmedLeagues') : undefined}
                >
                  {confirmed.length === 0 ? <p>No confirmed league placements are listed yet.</p> : null}
                  {confirmed.map((selection) => (
                    <div key={selection.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                      <p className="font-medium">{selection.leagueName ?? label(selection.selectionType)}</p>
                      <p className="text-sm text-gray-600 dark:text-gray-300">
                        Status: {label(selection.status)}
                        {selection.isTemporarySabbaticalFill ? ' · Temporary sabbatical-fill spot. The original member may return in a future session.' : ''}
                      </p>
                    </div>
                  ))}
                </Section>

                <Section title="League play-ins">
                  {playIns.length === 0 ? <p>No league play-ins are listed.</p> : null}
                  {playIns.map((selection) => (
                    <div key={selection.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                      <p className="font-medium">{selection.leagueName ?? label(selection.selectionType)}</p>
                      <p className="text-sm text-gray-600 dark:text-gray-300">
                        {selection.replacesLeagueId
                          ? `REPLACE${
                              selection.replacedLeagueName ? ` · Would replace ${selection.replacedLeagueName}` : ''
                            }`
                          : 'ADD'}
                        {' · '}
                        Placement depends on play-in results.
                      </p>
                      {selection.byotTeammateText ? (
                        <p className="text-sm text-gray-600 dark:text-gray-300">
                          Pending teammates (not yet registered): {rosterTextDisplay(selection.byotTeammateText)}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </Section>

                <Section
                  title="Sabbaticals"
                  onEdit={canEdit && sabbaticals.length > 0 ? () => setActiveEditModal('sabbaticals') : undefined}
                >
                  {sabbaticals.length === 0 ? <p>No sabbaticals are listed for this registration.</p> : null}
                  {sabbaticals.map((selection) => (
                    <div key={selection.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                      <p className="font-medium">{selection.leagueName}</p>
                      <p className="text-sm text-gray-600 dark:text-gray-300">
                        This preserves the curler’s return right under the sabbatical rules. Sabbaticals are time-limited.
                      </p>
                    </div>
                  ))}
                </Section>

                <Section
                  title="Waitlists"
                  onEdit={canEdit ? () => setActiveEditModal('waitlists') : undefined}
                >
                  {detail.waitlists.length === 0 ? <p>No active waitlist entries are listed.</p> : null}
                  {detail.waitlists.map((entry) => (
                    <div key={entry.id} className="flex flex-col gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="font-medium">{entry.waitlistName || entry.leagueName}</p>
                        <p className="text-sm text-gray-600 dark:text-gray-300">
                          {entry.entryType.toUpperCase()} waitlist
                          {entry.entryType === 'replace' && entry.replacesLeagueId
                            ? ` · Would replace league #${entry.replacesLeagueId} in this session`
                            : ''}
                          {' · '}
                          Position {entry.position ?? 'not available'} · Declines {entry.declineCount}
                          {entry.rolledOverFromWaitlistEntryId ? ' · Carried from a prior session entry' : ''}
                        </p>
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

                <Section
                  title="Third-league interest"
                  onEdit={canEdit ? () => setActiveEditModal('thirdLeague') : undefined}
                >
                  {thirdLeague.length === 0 ? <p>No third-league interest choices are listed.</p> : null}
                  {thirdLeague.map((selection) => (
                    <p key={selection.id}>{selection.rank ? `${selection.rank}. ` : ''}{selection.leagueName}</p>
                  ))}
                  {thirdLeague.length > 0 ? <p className="text-sm text-gray-600 dark:text-gray-300">These are interest choices only. They are handled after first- and second-league demand is satisfied.</p> : null}
                </Section>

                <Section
                  title="BYOT requests"
                  onEdit={canEdit ? () => setActiveEditModal('byot') : undefined}
                >
                  {byot.length === 0 ? <p>No BYOT requests are listed.</p> : null}
                  {byot.map((selection) => (
                    <div key={selection.id}>
                      <p className="font-medium">{selection.leagueName}</p>
                      <p>Teammates: {selection.byotTeammateText || 'Not provided'}</p>
                      <p className="text-sm text-gray-600 dark:text-gray-300">Bring-your-own-team placement is coordinated by the league coordinator.</p>
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
    </Layout>
  );
}
