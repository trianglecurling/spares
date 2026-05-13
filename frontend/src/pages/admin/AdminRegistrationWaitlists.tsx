import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Layout from '../../components/Layout';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppStateCard from '../../components/AppStateCard';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import api, { getApiErrorMessage } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';

type DashboardLeague = {
  id: number;
  name: string;
  sessionId: number | null;
  capacity: number;
  confirmedPlacements: number;
  permanentVacancies: number;
  temporarySabbaticalFillVacancies: number;
  activeWaitlistEntries: number;
  pendingOffers: number;
  rolloverOccurred: boolean;
  warnings: string[];
};

type WaitlistOffer = {
  id: number;
  offer_type: 'permanent' | 'temporary_sabbatical_fill';
  status: 'pending' | 'accepted' | 'declined' | 'expired_accepted' | 'cancelled';
  expires_at: string;
  source_registration_id: number | null;
};

type WaitlistEntry = {
  id: number;
  memberId: number;
  memberName: string;
  memberEmail: string;
  entryType: 'add' | 'replace';
  replacesLeagueId: number | null;
  position: number;
  declineCount: number;
  status: string;
  sourceRegistrationId: number | null;
  pendingOffer: WaitlistOffer | null;
  acceptedOffer: WaitlistOffer | null;
};

type RosterRow = {
  id: number;
  memberId: number;
  memberName: string;
  memberEmail: string;
  registrationId: number | null;
  status: string;
  placementType: string | null;
  temporary: boolean;
};

type AuditRow = {
  id: number;
  action: string;
  source: string;
  reason: string | null;
  created_at: string;
};

type LeagueDetail = {
  league: {
    id: number;
    name: string;
    capacity: number;
    leagueType: string;
    feeMinor: number;
    firstDayOfPlay: string | null;
    lastDayOfPlay: string | null;
    permanentVacancies: number;
    temporarySabbaticalFillVacancies: number;
    warnings: string[];
  };
  roster: RosterRow[];
  waitlistEntries: WaitlistEntry[];
  auditEvents: AuditRow[];
};

function formatMoney(minor: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minor / 100);
}

function formatStatus(value: string): string {
  return value.replace(/_/g, ' ');
}

function warningLabel(code: string): string {
  const labels: Record<string, string> = {
    missing_capacity: 'Missing capacity',
    missing_first_day_of_play: 'Missing first day of play',
    missing_last_day_of_play: 'Missing last day of play',
    missing_successor_league: 'Missing successor league',
    pending_offer_past_deadline: 'Pending offer past deadline',
  };
  return labels[code] ?? formatStatus(code);
}

function statusBadgeClass(status: string): string {
  if (status === 'pending') return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200';
  if (status === 'active' || status === 'accepted' || status === 'placed' || status === 'expired_accepted') {
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200';
  }
  if (status === 'declined' || status === 'cancelled' || status === 'removed') {
    return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200';
  }
  return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200';
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize ${statusBadgeClass(status)}`}>
      {formatStatus(status)}
    </span>
  );
}

type ReasonDialogState = {
  title: string;
  description: string;
  confirmText: string;
  variant?: 'danger' | 'primary';
  onSubmit: (reason: string) => Promise<void>;
} | null;

function ReasonDialog({
  state,
  onClose,
}: {
  state: ReasonDialogState;
  onClose: () => void;
}) {
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (state) setReason('');
  }, [state]);

  if (!state) return null;

  const submit = async () => {
    if (!reason.trim()) return;
    setSubmitting(true);
    try {
      await state.onSubmit(reason.trim());
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/50" />
        <div className="relative w-full max-w-lg rounded-xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-800">
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{state.title}</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300">{state.description}</p>
          </div>
          <FormField label="Reason" htmlFor={reasonId} required className="mt-5">
            {({ describedBy, invalid }) => (
              <textarea
                id={reasonId}
                className="app-input min-h-28"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                placeholder="Explain why staff is making this change."
              />
            )}
          </FormField>
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              variant={state.variant === 'danger' ? 'danger' : 'primary'}
              onClick={submit}
              disabled={submitting || !reason.trim()}
            >
              {state.confirmText}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminRegistrationWaitlists() {
  const { leagueId } = useParams();
  return leagueId ? <LeagueManager leagueId={Number(leagueId)} /> : <WaitlistDashboard />;
}

function WaitlistDashboard() {
  const [leagues, setLeagues] = useState<DashboardLeague[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ leagues: DashboardLeague[] }>('/registration/waitlists/dashboard');
      setLeagues(res.data.leagues);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Unable to load waitlist dashboard.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(
    () => ({
      permanent: leagues.reduce((sum, league) => sum + league.permanentVacancies, 0),
      temporary: leagues.reduce((sum, league) => sum + league.temporarySabbaticalFillVacancies, 0),
      waitlist: leagues.reduce((sum, league) => sum + league.activeWaitlistEntries, 0),
      offers: leagues.reduce((sum, league) => sum + league.pendingOffers, 0),
    }),
    [leagues]
  );

  return (
    <Layout>
      <AppPage>
        <AppPageHeader
          title="Staff waitlists"
          description="Review registration waitlists, vacancies, offers, placements, and audit history for standard leagues."
          actions={<Button variant="secondary" onClick={() => void load()}>Refresh</Button>}
        />

        {loading ? (
          <AppStateCard title="Loading waitlists" description="Gathering vacancies, pending offers, and warning indicators." />
        ) : error ? (
          <AppStateCard title="Unable to load waitlists" description={error} action={<Button onClick={() => void load()}>Try again</Button>} />
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-4">
              <SummaryCard label="Permanent vacancies" value={totals.permanent} />
              <SummaryCard label="Temporary fill vacancies" value={totals.temporary} />
              <SummaryCard label="Active waitlist entries" value={totals.waitlist} />
              <SummaryCard label="Pending offers" value={totals.offers} />
            </div>
            <div className="app-card overflow-hidden p-0">
              <table className="app-table">
                <thead className="app-table-header">
                  <tr>
                    <th className="app-table-th">League</th>
                    <th className="app-table-th text-right">Capacity</th>
                    <th className="app-table-th text-right">Placed</th>
                    <th className="app-table-th text-right">Permanent</th>
                    <th className="app-table-th text-right">Temporary</th>
                    <th className="app-table-th text-right">Waitlist</th>
                    <th className="app-table-th text-right">Offers</th>
                    <th className="app-table-th">Warnings</th>
                    <th className="app-table-th text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="app-table-body">
                  {leagues.map((league) => (
                    <tr key={league.id} className="app-table-row">
                      <td className="app-table-td font-medium text-gray-900 dark:text-white">{league.name}</td>
                      <td className="app-table-td text-right">{league.capacity}</td>
                      <td className="app-table-td text-right">{league.confirmedPlacements}</td>
                      <td className="app-table-td text-right">{league.permanentVacancies}</td>
                      <td className="app-table-td text-right">{league.temporarySabbaticalFillVacancies}</td>
                      <td className="app-table-td text-right">{league.activeWaitlistEntries}</td>
                      <td className="app-table-td text-right">{league.pendingOffers}</td>
                      <td className="app-table-td">
                        {league.warnings.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {league.warnings.map((warning) => (
                              <span key={warning} className="rounded-full bg-yellow-100 px-2 py-1 text-xs text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200">
                                {warningLabel(warning)}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-500 dark:text-gray-400">None</span>
                        )}
                      </td>
                      <td className="app-table-td text-right">
                        <Link className="text-sm font-medium text-primary-teal hover:underline" to={`/admin/registration/waitlists/${league.id}`}>
                          Manage
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </AppPage>
    </Layout>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="app-card">
      <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-gray-900 dark:text-white">{value}</p>
    </div>
  );
}

function LeagueManager({ leagueId }: { leagueId: number }) {
  const { showAlert } = useAlert();
  const [data, setData] = useState<LeagueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ReasonDialogState>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<LeagueDetail>(`/registration/waitlists/leagues/${leagueId}`);
      setData(res.data);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Unable to load league waitlist.'));
    } finally {
      setLoading(false);
    }
  }, [leagueId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = useCallback(
    (action: (reason: string) => Promise<void>, successMessage: string) => async (reason: string) => {
      try {
        await action(reason);
        showAlert(successMessage, 'success');
        await load();
      } catch (err) {
        showAlert(getApiErrorMessage(err, 'Staff action failed.'), 'error');
        throw err;
      }
    },
    [load, showAlert]
  );

  const openReasonDialog = (state: ReasonDialogState) => setDialog(state);

  if (loading) {
    return (
      <Layout>
        <AppPage>
          <AppStateCard title="Loading league waitlist" description="Gathering roster, waitlist entries, offers, and audit history." />
        </AppPage>
      </Layout>
    );
  }

  if (error || !data) {
    return (
      <Layout>
        <AppPage>
          <AppStateCard title="Unable to load league waitlist" description={error ?? 'The league waitlist was not found.'} action={<Button onClick={() => void load()}>Try again</Button>} />
        </AppPage>
      </Layout>
    );
  }

  return (
    <Layout>
      <AppPage>
        <AppPageHeader
          title={data.league.name}
          description="Manage waitlist offers, placements, manual corrections, and audit history."
          actions={
            <>
              <Link className="inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700" to="/admin/registration/waitlists">
                Back to dashboard
              </Link>
              <Button variant="secondary" onClick={() => void load()}>Refresh</Button>
            </>
          }
        />

        <div className="grid gap-4 md:grid-cols-4">
          <SummaryCard label="Capacity" value={data.league.capacity} />
          <SummaryCard label="Permanent vacancies" value={data.league.permanentVacancies} />
          <SummaryCard label="Temporary fill vacancies" value={data.league.temporarySabbaticalFillVacancies} />
          <div className="app-card">
            <p className="text-sm text-gray-500 dark:text-gray-400">League fee</p>
            <p className="mt-2 text-3xl font-semibold text-gray-900 dark:text-white">{formatMoney(data.league.feeMinor)}</p>
          </div>
        </div>

        <AppPageControlsRow
          left={
            <div className="flex flex-wrap gap-2">
              {data.league.warnings.length ? data.league.warnings.map((warning) => <StatusBadge key={warning} status={warningLabel(warning)} />) : <StatusBadge status="ready" />}
            </div>
          }
          right={
            <>
              <Button
                onClick={() =>
                  openReasonDialog({
                    title: 'Send permanent offer',
                    description: 'Send one permanent spot offer to the top eligible active waitlist entry.',
                    confirmText: 'Send offer',
                    onSubmit: runAction(
                      (reason) => api.post(`/registration/waitlists/leagues/${leagueId}/offers`, { offerType: 'permanent', count: 1, reason }),
                      'Permanent offer sent.'
                    ),
                  })
                }
              >
                Send permanent offer
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  openReasonDialog({
                    title: 'Send temporary sabbatical-fill offer',
                    description: 'Send one temporary offer to the top eligible active waitlist entry. The curler keeps their permanent waitlist position.',
                    confirmText: 'Send temporary offer',
                    onSubmit: runAction(
                      (reason) => api.post(`/registration/waitlists/leagues/${leagueId}/offers`, { offerType: 'temporary_sabbatical_fill', count: 1, reason }),
                      'Temporary offer sent.'
                    ),
                  })
                }
              >
                Send temporary offer
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  openReasonDialog({
                    title: 'Roll waitlist forward',
                    description: 'Roll active waitlist entries to the configured successor league. This is idempotent and audited.',
                    confirmText: 'Run rollover',
                    onSubmit: runAction(
                      (reason) => api.post(`/registration/waitlists/leagues/${leagueId}/rollover`, { reason }),
                      'Waitlist rollover completed.'
                    ),
                  })
                }
              >
                Run rollover
              </Button>
            </>
          }
        />

        <section className="app-card">
          <h2 className="app-section-title">Waitlist entries</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="app-table">
              <thead className="app-table-header">
                <tr>
                  <th className="app-table-th">Position</th>
                  <th className="app-table-th">Member</th>
                  <th className="app-table-th">Type</th>
                  <th className="app-table-th">Declines</th>
                  <th className="app-table-th">Status</th>
                  <th className="app-table-th">Pending offer</th>
                  <th className="app-table-th text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="app-table-body">
                {data.waitlistEntries.map((entry) => (
                  <tr key={entry.id} className="app-table-row">
                    <td className="app-table-td">{entry.position}</td>
                    <td className="app-table-td">
                      <div className="font-medium text-gray-900 dark:text-white">{entry.memberName}</div>
                      <div className="text-xs text-gray-500">{entry.memberEmail}</div>
                    </td>
                    <td className="app-table-td">
                      {entry.entryType.toUpperCase()}
                      {entry.replacesLeagueId ? <span className="ml-1 text-xs text-gray-500">replaces {entry.replacesLeagueId}</span> : null}
                    </td>
                    <td className="app-table-td">{entry.declineCount}</td>
                    <td className="app-table-td"><StatusBadge status={entry.status} /></td>
                    <td className="app-table-td">
                      {entry.pendingOffer ? (
                        <div className="space-y-1">
                          <StatusBadge status={entry.pendingOffer.offer_type} />
                          <div className="text-xs text-gray-500">Expires {new Date(entry.pendingOffer.expires_at).toLocaleString()}</div>
                        </div>
                      ) : (
                        <span className="text-gray-500">None</span>
                      )}
                    </td>
                    <td className="app-table-td">
                      <div className="flex flex-wrap justify-end gap-2">
                        {entry.pendingOffer ? (
                          <>
                            <Button
                              className="px-3 py-1.5"
                              onClick={() =>
                                openReasonDialog({
                                  title: 'Mark offer accepted',
                                  description: 'This will place the member according to the offer type and audit the placement.',
                                  confirmText: 'Mark accepted',
                                  onSubmit: runAction(
                                    (reason) => api.post(`/registration/waitlists/offers/${entry.pendingOffer?.id}/accept`, { reason }),
                                    'Offer accepted and placement processed.'
                                  ),
                                })
                              }
                            >
                              Accept
                            </Button>
                            <Button
                              variant="secondary"
                              className="px-3 py-1.5"
                              onClick={() =>
                                openReasonDialog({
                                  title: 'Mark offer declined',
                                  description: 'Declines count toward waitlist movement rules. A second decline moves the member to the bottom.',
                                  confirmText: 'Mark declined',
                                  variant: 'danger',
                                  onSubmit: runAction(
                                    (reason) => api.post(`/registration/waitlists/offers/${entry.pendingOffer?.id}/decline`, { reason }),
                                    'Offer declined.'
                                  ),
                                })
                              }
                            >
                              Decline
                            </Button>
                            <Button
                              variant="outline-danger"
                              className="px-3 py-1.5"
                              onClick={() =>
                                openReasonDialog({
                                  title: 'Cancel offer',
                                  description: 'Cancel this pending offer without applying decline rules.',
                                  confirmText: 'Cancel offer',
                                  variant: 'danger',
                                  onSubmit: runAction(
                                    (reason) => api.post(`/registration/waitlists/offers/${entry.pendingOffer?.id}/cancel`, { reason }),
                                    'Offer cancelled.'
                                  ),
                                })
                              }
                            >
                              Cancel
                            </Button>
                          </>
                        ) : null}
                        {entry.acceptedOffer ? (
                          <Button
                            variant="secondary"
                            className="px-3 py-1.5"
                            onClick={() =>
                              openReasonDialog({
                                title: 'Trigger payment link',
                                description: 'Create a checkout link after staff has resolved placement uncertainty.',
                                confirmText: 'Trigger payment',
                                onSubmit: runAction(
                                  (reason) => api.post(`/registration/waitlists/offers/${entry.acceptedOffer?.id}/payment-link`, { reason }),
                                  'Payment link generated.'
                                ),
                              })
                            }
                          >
                            Payment
                          </Button>
                        ) : null}
                        <Button
                          variant="secondary"
                          className="px-3 py-1.5"
                          onClick={() =>
                            openReasonDialog({
                              title: 'Move entry to bottom',
                              description: 'Move this member to the bottom of the active waitlist and reset the practical decline position.',
                              confirmText: 'Move to bottom',
                              variant: 'danger',
                              onSubmit: runAction(
                                (reason) => api.post(`/registration/waitlists/entries/${entry.id}/move-to-bottom`, { reason }),
                                'Entry moved to bottom.'
                              ),
                            })
                          }
                        >
                          Move bottom
                        </Button>
                        <Button
                          variant="outline-danger"
                          className="px-3 py-1.5"
                          onClick={() =>
                            openReasonDialog({
                              title: 'Remove waitlist entry',
                              description: 'Remove this member from the active waitlist. Re-adding them later creates a new waitlist instance.',
                              confirmText: 'Remove',
                              variant: 'danger',
                              onSubmit: runAction(
                                (reason) => api.delete(`/registration/waitlists/entries/${entry.id}`, { data: { reason } }),
                                'Waitlist entry removed.'
                              ),
                            })
                          }
                        >
                          Remove
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="app-card">
            <h2 className="app-section-title">Current roster and placements</h2>
            <div className="mt-4 space-y-3">
              {data.roster.length ? data.roster.map((row) => (
                <div key={row.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">{row.memberName}</p>
                      <p className="text-xs text-gray-500">{row.memberEmail}</p>
                    </div>
                    <StatusBadge status={row.temporary ? 'temporary placement' : row.placementType ?? row.status} />
                  </div>
                </div>
              )) : <p className="text-sm text-gray-500">No roster placements yet.</p>}
            </div>
          </div>
          <div className="app-card">
            <h2 className="app-section-title">Audit history</h2>
            <div className="mt-4 max-h-96 space-y-3 overflow-y-auto">
              {data.auditEvents.length ? data.auditEvents.map((event) => (
                <div key={event.id} className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-gray-900 dark:text-white">{formatStatus(event.action)}</span>
                    <span className="text-xs text-gray-500">{new Date(event.created_at).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 text-gray-600 dark:text-gray-300">{event.reason ?? event.source}</p>
                </div>
              )) : <p className="text-sm text-gray-500">No audit events yet.</p>}
            </div>
          </div>
        </section>
      </AppPage>
      <ReasonDialog state={dialog} onClose={() => setDialog(null)} />
    </Layout>
  );
}
