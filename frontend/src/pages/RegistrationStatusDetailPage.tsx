import { Link, useParams } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { AppPage, AppPageHeader } from '../components/AppPage';
import AppStateCard from '../components/AppStateCard';
import Button from '../components/Button';
import BackButton from '../components/BackButton';
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
  isTemporarySabbaticalFill: number;
  byotTeammateText: string | null;
};

type WaitlistEntry = {
  id: number;
  leagueName: string;
  entryType: 'add' | 'replace';
  declineCount: number;
  position: number | null;
  rolledOverFromWaitlistEntryId: number | null;
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
};

function label(value: string | null | undefined) {
  return value ? value.replace(/_/g, ' ') : 'Not available';
}

function money(minor: number | null) {
  if (minor == null) return 'Not available';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minor / 100);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="app-card space-y-4">
      <h2 className="app-section-title">{title}</h2>
      {children}
    </section>
  );
}

export default function RegistrationStatusDetailPage() {
  const { registrationId } = useParams();
  const { confirm } = useConfirm();
  const { showAlert } = useAlert();
  const [detail, setDetail] = useState<RegistrationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!registrationId) return;
    setLoading(true);
    try {
      const response = await api.get<RegistrationDetail>(`/registration/member/registrations/${registrationId}`);
      setDetail(response.data);
      setError(null);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Unable to load registration.'));
    } finally {
      setLoading(false);
    }
  }, [registrationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function removeWaitlist(entry: WaitlistEntry) {
    const ok = await confirm({
      title: 'Remove from waitlist?',
      message: `Are you sure you want to remove yourself from the waitlist for ${entry.leagueName}?\n\nYou will give up your current waitlist position. If you join this waitlist again later, you will be added as a new entry.`,
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

  const confirmed = detail?.selections.filter((selection) => ['confirmed', 'placed'].includes(selection.status)) ?? [];
  const thirdLeague = detail?.selections.filter((selection) => selection.selectionType === 'third_league_interest') ?? [];
  const byot = detail?.selections.filter((selection) => selection.selectionType === 'byot_request') ?? [];
  const sabbaticals = detail?.selections.filter((selection) => selection.selectionType === 'sabbatical') ?? [];

  return (
    <Layout>
      <AppPage>
        <AppPageHeader
          title={detail ? `Registration for ${detail.registration.curlerName}` : 'Registration details'}
          description={detail ? `${detail.registration.seasonName ?? 'Season'} / ${detail.registration.sessionName ?? 'Session'}` : undefined}
          actions={<BackButton to="/registration/status" label="Back to registrations" />}
        />

        {loading ? <AppStateCard title="Loading registration" description="Gathering the latest status." /> : null}
        {error ? <AppStateCard title="Unable to load registration" description={error} /> : null}

        {detail ? (
          <div className="grid gap-4">
            <Section title="Membership and payment">
              <div className="grid gap-3 md:grid-cols-2">
                <p>Membership/program: {label(detail.registration.membershipOption)}</p>
                <p>Registration status: {label(detail.registration.registrationStatus)}</p>
                <p>Payment status: {label(detail.payment.status)}</p>
                <p>Amount due: {money(detail.payment.amountDueMinor)}</p>
              </div>
              {detail.registration.studentDiscountClaimed ? <p>Student discount claimed.</p> : null}
              {detail.registration.reciprocalDiscountClaimed ? <p>Reciprocal discount claimed.</p> : null}
              {detail.payment.paymentLink ? (
                <a href={detail.payment.paymentLink}>
                  <Button>Pay now</Button>
                </a>
              ) : detail.payment.status === 'deferred' ? (
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  You do not need to pay yet. Some choices require placement or staff review first.
                </p>
              ) : null}
            </Section>

            <Section title="Confirmed leagues">
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

            <Section title="Sabbaticals">
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

            <Section title="Waitlists">
              {detail.waitlists.length === 0 ? <p>No active waitlist entries are listed.</p> : null}
              {detail.waitlists.map((entry) => (
                <div key={entry.id} className="flex flex-col gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-medium">{entry.leagueName}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      {entry.entryType.toUpperCase()} waitlist · Position {entry.position ?? 'not available'} · Declines {entry.declineCount}
                      {entry.rolledOverFromWaitlistEntryId ? ' · Rolled over from a prior session' : ''}
                    </p>
                  </div>
                  <Button variant="outline-danger" onClick={() => void removeWaitlist(entry)}>Remove from waitlist</Button>
                </div>
              ))}
            </Section>

            <Section title="Third-league interest">
              {thirdLeague.length === 0 ? <p>No third-league interest choices are listed.</p> : null}
              {thirdLeague.map((selection) => (
                <p key={selection.id}>{selection.rank ? `${selection.rank}. ` : ''}{selection.leagueName}</p>
              ))}
              {thirdLeague.length > 0 ? <p className="text-sm text-gray-600 dark:text-gray-300">These are interest choices only. They are handled after first- and second-league demand is satisfied.</p> : null}
            </Section>

            <Section title="BYOT requests">
              {byot.length === 0 ? <p>No BYOT requests are listed.</p> : null}
              {byot.map((selection) => (
                <div key={selection.id}>
                  <p className="font-medium">{selection.leagueName}</p>
                  <p>Teammates: {selection.byotTeammateText || 'Not provided'}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-300">Bring-your-own-team placement is coordinated by the league coordinator.</p>
                </div>
              ))}
            </Section>

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

            <Link to="/registration/status" className="text-primary-teal hover:underline">Back to all registrations</Link>
          </div>
        ) : null}
      </AppPage>
    </Layout>
  );
}
