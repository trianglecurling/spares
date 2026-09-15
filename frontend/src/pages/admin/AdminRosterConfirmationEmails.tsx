import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { get, patch, post } from '../../api/client';
import type { paths } from '../../api/generated/types';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import AppStateCard from '../../components/AppStateCard';
import Button from '../../components/Button';
import ChoiceInput from '../../components/ChoiceInput';
import FormField from '../../components/FormField';
import DataTable from '../../components/table/DataTable';
import type { DataTableColumn } from '../../components/table/tableTypes';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import useTableQueryState from '../../hooks/useTableQueryState';
import api, { getApiErrorMessage } from '../../utils/api';
import MemberEmail from '../../components/MemberEmail';
import ReviewFinancialAssistanceModal from '../../components/registration/ReviewFinancialAssistanceModal';
import { canReviewFinancialAssistance } from '../../components/registration/financialAssistanceReviewShared';
import { financialAssistanceLabel } from '../../components/registration/registrationCollectedDetailsShared';
import { rosterConfirmationEmailPreviewPath } from './rosterConfirmationEmailPaths';
import {
  canHoldRosterConfirmationEmail,
  isRosterConfirmationPaymentReminder,
  rosterConfirmationSendAllMemberIds,
  rosterConfirmationUnpaidReminderMemberIds,
  useRosterConfirmationEmailHolds,
} from './rosterConfirmationEmailHolds';
import {
  rosterConfirmationSendErrorsFromJob,
  rosterConfirmationSendJobErrors,
  rosterConfirmationSendProgressFromJob,
  rosterConfirmationSendProgressLabel,
  rosterConfirmationSendProgressPercent,
} from './rosterConfirmationEmailSend';

type RegistrationSession = {
  id: number;
  seasonId: number;
  seasonName: string;
  name: string;
  isDefault: boolean;
};

type RosterConfirmationList = paths['/registration/staff/roster-confirmation-emails']['get']['responses']['200']['content']['application/json'];
type RosterConfirmationRecipient = RosterConfirmationList['recipients'][number];

type BalanceFilter = 'all' | 'due' | 'credit' | 'settled';
type SentFilter = 'all' | 'unsent' | 'sent' | 'held';
type AssistanceFilter = 'all' | 'pending' | 'reviewed';
type SortKey = 'name' | 'owed' | 'paid' | 'balance';

const PAGE_SIZE = 50;
const SORT_KEYS = ['name', 'owed', 'paid', 'balance'] as const;

const BALANCE_FILTER_OPTIONS: Array<{ value: BalanceFilter; label: string }> = [
  { value: 'all', label: 'All balances' },
  { value: 'due', label: 'Owes payment' },
  { value: 'credit', label: 'Overpaid' },
  { value: 'settled', label: 'Settled' },
];

const SENT_FILTER_OPTIONS: Array<{ value: SentFilter; label: string }> = [
  { value: 'all', label: 'All emails' },
  { value: 'unsent', label: 'Unsent' },
  { value: 'held', label: 'Held' },
  { value: 'sent', label: 'Sent' },
];

const ASSISTANCE_FILTER_OPTIONS: Array<{ value: AssistanceFilter; label: string }> = [
  { value: 'all', label: 'All assistance' },
  { value: 'pending', label: 'Needs review' },
  { value: 'reviewed', label: 'Reviewed' },
];

function money(minor: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minor / 100);
}

function matchesBalanceFilter(balanceMinor: number, filter: BalanceFilter): boolean {
  if (filter === 'due') return balanceMinor > 0;
  if (filter === 'credit') return balanceMinor < 0;
  if (filter === 'settled') return balanceMinor === 0;
  return true;
}

function paymentStatusLabel(row: RosterConfirmationRecipient): string {
  if (row.balanceMinor > 0) return 'Payment due';
  if (row.balanceMinor < 0) return 'Refund pending';
  return 'Settled';
}

export default function AdminRosterConfirmationEmails() {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const sessionFieldId = useId();
  const searchFieldId = useId();
  const balanceFieldId = useId();
  const sentFieldId = useId();
  const assistanceFieldId = useId();
  const [searchParams, setSearchParams] = useSearchParams();
  const { page, sort, filters, setPage, setSort, setFilter } = useTableQueryState<
    SortKey,
    { search: string; balance: string; sent: string; assistance: string }
  >({
    defaultSort: { key: 'name', direction: 'asc' },
    sortKeys: SORT_KEYS,
    filterConfig: {
      search: { queryKey: 'search', defaultValue: '' },
      balance: {
        queryKey: 'balance',
        defaultValue: 'all',
        parse: (raw) => (raw && ['due', 'credit', 'settled'].includes(raw) ? raw : 'all'),
      },
      sent: {
        queryKey: 'sent',
        defaultValue: 'all',
        parse: (raw) => (raw && ['unsent', 'held', 'sent'].includes(raw) ? raw : 'all'),
      },
      assistance: {
        queryKey: 'assistance',
        defaultValue: 'all',
        parse: (raw) => (raw && ['pending', 'reviewed'].includes(raw) ? raw : 'all'),
      },
    },
  });
  const [sessions, setSessions] = useState<RegistrationSession[]>([]);
  const [defaultSessionId, setDefaultSessionId] = useState<number | null>(null);
  const [payload, setPayload] = useState<RosterConfirmationList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingSend, setStartingSend] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [sendErrors, setSendErrors] = useState<Record<number, string>>({});
  const [reviewTarget, setReviewTarget] = useState<RosterConfirmationRecipient | null>(null);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const watchedRunningJobIds = useRef(new Set<number>());
  const announcedJobKeys = useRef(new Set<string>());

  const sessionId = Number(searchParams.get('sessionId')) || defaultSessionId;
  const { heldSet, setHeld, setHeldMany } = useRosterConfirmationEmailHolds(sessionId && sessionId > 0 ? sessionId : null);
  const search = filters.search;
  const balanceFilter = (['all', 'due', 'credit', 'settled'].includes(filters.balance) ? filters.balance : 'all') as BalanceFilter;
  const sentFilter = (['all', 'unsent', 'held', 'sent'].includes(filters.sent) ? filters.sent : 'all') as SentFilter;
  const assistanceFilter = (
    ['all', 'pending', 'reviewed'].includes(filters.assistance) ? filters.assistance : 'all'
  ) as AssistanceFilter;

  const setSessionId = useCallback(
    (nextSessionId: string) => {
      const next = new URLSearchParams(searchParams);
      next.set('sessionId', nextSessionId);
      next.delete('page');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const [searchDraft, setSearchDraft] = useState(search);
  const [searchDraftSource, setSearchDraftSource] = useState(search);
  if (searchDraftSource !== search) {
    setSearchDraft(search);
    setSearchDraftSource(search);
  }

  const loadSessions = useCallback(async () => {
    const response = await api.get<{ sessions: RegistrationSession[]; defaultSessionId: number | null }>(
      '/registration/staff/sessions',
    );
    setSessions(response.data.sessions);
    setDefaultSessionId(response.data.defaultSessionId);
    if (!searchParams.get('sessionId') && response.data.defaultSessionId) {
      setSessionId(String(response.data.defaultSessionId));
    }
  }, [searchParams, setSessionId]);

  const loadRecipients = useCallback(async (options?: { silent?: boolean }) => {
    if (!sessionId) {
      setLoading(false);
      setPayload(null);
      return;
    }
    if (!options?.silent) setLoading(true);
    setError(null);
    try {
      const data = await get('/registration/staff/roster-confirmation-emails', { sessionId });
      setPayload(data);
      if (data.sendJob) {
        setSendErrors(rosterConfirmationSendErrorsFromJob(data.sendJob));
      }
    } catch (err) {
      if (!options?.silent) {
        setPayload(null);
        setError(getApiErrorMessage(err, 'Unable to load roster confirmation emails.'));
      }
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void loadSessions().catch((err) => setError(getApiErrorMessage(err, 'Unable to load sessions.')));
  }, [loadSessions]);

  useEffect(() => {
    void loadRecipients();
  }, [loadRecipients]);

  const sendJob = payload?.sendJob ?? null;
  const jobRunning = sendJob?.status === 'running';
  const sendBusy = startingSend || jobRunning;

  useEffect(() => {
    if (sendJob?.status === 'running') {
      watchedRunningJobIds.current.add(sendJob.id);
    }
  }, [sendJob?.id, sendJob?.status]);

  useEffect(() => {
    if (!sessionId || sendJob?.status !== 'running') return;
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await get('/registration/staff/roster-confirmation-emails/send-status', { sessionId });
        if (cancelled) return;
        setPayload((current) => (current ? { ...current, sendJob: data.sendJob } : current));
        if (data.sendJob) {
          setSendErrors(rosterConfirmationSendErrorsFromJob(data.sendJob));
        }
      } catch {
        // Keep the last known job; the next poll retries.
      }
    };
    const intervalId = window.setInterval(() => {
      void poll();
    }, 1500);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [sessionId, sendJob?.id, sendJob?.status]);

  useEffect(() => {
    if (!sendJob || sendJob.status === 'running') return;
    if (!watchedRunningJobIds.current.has(sendJob.id)) return;
    const key = `${sendJob.id}:${sendJob.status}:${sendJob.finishedAt ?? ''}`;
    if (announcedJobKeys.current.has(key)) return;
    announcedJobKeys.current.add(key);
    const errorCount = sendJob.errors.filter((row) => row.memberId > 0).length;
    const jobErrors = rosterConfirmationSendJobErrors(sendJob);
    const sentLabel = `${sendJob.sent} email${sendJob.sent === 1 ? '' : 's'}`;
    if (jobErrors.length > 0) {
      showAlert(
        sendJob.sent > 0 ? `${jobErrors[0]} Sent ${sentLabel} before stopping.` : jobErrors[0],
        sendJob.sent > 0 ? 'warning' : 'error',
      );
    } else {
      showAlert(
        errorCount > 0 ? `Sent ${sentLabel}; ${errorCount} could not be sent.` : `Sent ${sentLabel}.`,
        errorCount > 0 ? 'warning' : 'success',
      );
    }
    void loadRecipients({ silent: true });
  }, [loadRecipients, sendJob, showAlert]);

  const sessionOptions = useMemo(
    () =>
      sessions.map((session) => ({
        value: String(session.id),
        label: `${session.seasonName} / ${session.name}`,
      })),
    [sessions],
  );

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = (payload?.recipients ?? []).filter((row) => {
      if (!matchesBalanceFilter(row.balanceMinor, ['all', 'due', 'credit', 'settled'].includes(balanceFilter) ? balanceFilter : 'all')) {
        return false;
      }
      if (sentFilter === 'unsent' && row.alreadySent) return false;
      if (sentFilter === 'held' && (row.alreadySent || !heldSet.has(row.memberId))) return false;
      if (sentFilter === 'sent' && !row.alreadySent) return false;
      if (assistanceFilter === 'pending' && row.financialAssistance?.status !== 'pending') return false;
      if (assistanceFilter === 'reviewed' && (!row.financialAssistance || row.financialAssistance.status === 'pending')) {
        return false;
      }
      if (!needle) return true;
      return (
        row.memberName.toLowerCase().includes(needle) ||
        (row.memberEmail ?? '').toLowerCase().includes(needle) ||
        (row.parentEmail ?? '').toLowerCase().includes(needle) ||
        row.leagues.some((league) => league.leagueName.toLowerCase().includes(needle)) ||
        (row.membershipLabel ?? '').toLowerCase().includes(needle)
      );
    });
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sort.key === 'owed') {
        const diff = a.owedMinor - b.owedMinor;
        if (diff !== 0) return diff * direction;
      }
      if (sort.key === 'paid') {
        const diff = a.paidMinor - b.paidMinor;
        if (diff !== 0) return diff * direction;
      }
      if (sort.key === 'balance') {
        const diff = a.balanceMinor - b.balanceMinor;
        if (diff !== 0) return diff * direction;
      }
      const nameDiff = a.memberName.localeCompare(b.memberName);
      if (nameDiff !== 0) return nameDiff * (sort.key === 'name' ? direction : 1);
      return a.memberId - b.memberId;
    });
  }, [assistanceFilter, balanceFilter, heldSet, payload?.recipients, search, sentFilter, sort]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const unsentSendable = (payload?.recipients ?? []).filter((row) => canHoldRosterConfirmationEmail(row));
  const sendAllMemberIds = rosterConfirmationSendAllMemberIds(payload?.recipients ?? [], heldSet);
  const unpaidReminderMemberIds = rosterConfirmationUnpaidReminderMemberIds(payload?.recipients ?? []);
  const heldUnsentCount = unsentSendable.filter((row) => heldSet.has(row.memberId)).length;
  const selectedSendable = (payload?.recipients ?? []).filter((row) => selectedIds.includes(row.memberId) && row.canSend);
  const selectedReminders = selectedSendable.filter((row) => isRosterConfirmationPaymentReminder(row));
  const selectedHoldable = selectedSendable.filter((row) => canHoldRosterConfirmationEmail(row));
  const selectedToHold = selectedHoldable.filter((row) => !heldSet.has(row.memberId));
  const selectedToRelease = selectedHoldable.filter((row) => heldSet.has(row.memberId));
  const pendingAssistanceCount = (payload?.recipients ?? []).filter(
    (row) => row.financialAssistance?.status === 'pending',
  ).length;
  async function sendEmails(memberIds: number[], mode: 'selected' | 'unsent' | 'unpaid') {
    if (!sessionId) return;
    if (payload?.leagueProcessingActive || sendBusy) return;
    const count = memberIds.length;
    const unsentOnly = mode === 'unsent';
    const heldNote =
      unsentOnly && heldUnsentCount > 0
        ? ` ${heldUnsentCount} held ${heldUnsentCount === 1 ? 'email is' : 'emails are'} skipped.`
        : '';
    const reminderCopy =
      count === 1
        ? 'This sends a payment reminder using the existing Square payment link. A new payment link is not created.'
        : `This sends ${count} payment reminders using each member's existing Square payment link. New payment links are not created.`;
    const confirmed = await confirm({
      title:
        mode === 'unpaid'
          ? 'Send payment reminders?'
          : unsentOnly
            ? 'Send unsent roster emails?'
            : 'Send roster emails?',
      message:
        mode === 'unpaid'
          ? reminderCopy
          : count === 1
            ? `This sends the roster confirmation email.${heldNote} A Square payment link is created only if a remaining balance is due and no link exists yet. Follow-up reminders reuse the existing payment link. Credits are not refunded automatically.`
            : `This sends ${count} roster confirmation emails.${heldNote} Square payment links are created only for remaining balances that do not already have a link. Follow-up reminders reuse existing payment links. Credits are not refunded automatically.`,
      confirmText: mode === 'unpaid' ? 'Send reminders' : 'Send emails',
      cancelText: 'Cancel',
    });
    if (!confirmed) return;
    setStartingSend(true);
    setSendErrors({});
    try {
      const job = await post('/registration/staff/roster-confirmation-emails/send', {
        sessionId,
        memberIds,
        unsentOnly,
      });
      watchedRunningJobIds.current.add(job.id);
      setPayload((current) => (current ? { ...current, sendJob: job } : current));
      setSendErrors(rosterConfirmationSendErrorsFromJob(job));
      setSelectedIds([]);
    } catch (err) {
      showAlert(getApiErrorMessage(err, 'Failed to start roster confirmation emails.'), 'error');
    } finally {
      setStartingSend(false);
    }
  }

  async function saveAssistanceReview(input: {
    status: 'approved' | 'partially_approved' | 'denied';
    approvedPercentage: number;
    staffNotes: string | null;
  }) {
    const assistance = reviewTarget?.financialAssistance;
    if (!canReviewFinancialAssistance(assistance)) return;
    setReviewSaving(true);
    setReviewError(null);
    try {
      await patch(
        '/registration/staff/financial-assistance/{id}',
        {
          status: input.status,
          approvedPercentage: input.approvedPercentage,
          staffNotes: input.staffNotes,
        },
        { id: String(assistance.requestId) },
      );
      showAlert(
        input.status === 'denied'
          ? 'Financial assistance was denied. You can send the full-price invoice from this tab.'
          : 'Financial assistance was saved. You can send the discounted invoice from this tab.',
        'success',
      );
      setReviewTarget(null);
      await loadRecipients({ silent: true });
    } catch (err) {
      setReviewError(getApiErrorMessage(err, 'Unable to save this financial assistance review.'));
    } finally {
      setReviewSaving(false);
    }
  }

  const columns: Array<DataTableColumn<RosterConfirmationRecipient, SortKey>> = [
    {
      id: 'name',
      header: 'Member',
      sortable: true,
      sortKey: 'name',
      renderCell: (row) => (
        <div>
          <Link
            to={rosterConfirmationEmailPreviewPath(row.memberId, sessionId)}
            className="font-medium text-primary-teal-link hover:underline"
          >
            {row.memberName}
          </Link>
          {row.memberEmail ? (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              <MemberEmail email={row.memberEmail} parentEmail={row.parentEmail} />
            </div>
          ) : null}
        </div>
      ),
    },
    {
      id: 'leagues',
      header: 'Leagues or membership',
      renderCell: (row) =>
        row.leagues.length > 0 ? (
          <span>
            {row.leagues.map((league) => `${league.leagueName}${league.isTemporarySabbaticalFill ? '*' : ''}`).join(', ')}
          </span>
        ) : row.membershipLabel ? (
          <span>{row.membershipLabel}</span>
        ) : (
          <span className="text-gray-500 dark:text-gray-400">None</span>
        ),
    },
    {
      id: 'assistance',
      header: 'Assistance',
      renderCell: (row) => {
        const label = financialAssistanceLabel(row.financialAssistance);
        return label ? <span>{label}</span> : <span className="text-gray-500 dark:text-gray-400">None</span>;
      },
    },
    {
      id: 'owed',
      header: 'Owed',
      sortable: true,
      sortKey: 'owed',
      align: 'right',
      renderCell: (row) => <span className="tabular-nums">{money(row.owedMinor)}</span>,
    },
    {
      id: 'paid',
      header: 'Paid',
      sortable: true,
      sortKey: 'paid',
      align: 'right',
      renderCell: (row) => <span className="tabular-nums">{money(row.paidMinor)}</span>,
    },
    {
      id: 'balance',
      header: 'Balance',
      sortable: true,
      sortKey: 'balance',
      align: 'right',
      renderCell: (row) => {
        const tone =
          row.balanceMinor > 0
            ? 'text-amber-800 dark:text-amber-300'
            : row.balanceMinor < 0
              ? 'text-sky-700 dark:text-sky-300'
              : 'text-emerald-700 dark:text-emerald-400';
        return <span className={`tabular-nums font-medium ${tone}`}>{money(row.balanceMinor)}</span>;
      },
    },
    {
      id: 'payment',
      header: 'Payment',
      renderCell: (row) => paymentStatusLabel(row),
    },
    {
      id: 'sent',
      header: 'Email',
      renderCell: (row) => {
        const sendError = sendErrors[row.memberId];
        const status =
          row.skipReason === 'no_email'
            ? 'No email'
            : row.skipReason === 'no_registration'
              ? 'No registration'
              : row.skipReason === 'pending_financial_assistance'
                ? 'Needs review'
                : row.alreadySent
                  ? 'Sent'
                  : heldSet.has(row.memberId)
                    ? 'Held'
                    : 'Unsent';
        return (
          <div>
            <div>{status}</div>
            {sendError ? <div className="text-xs text-red-700 dark:text-red-400">{sendError}</div> : null}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <AppPageControlsRow
        left={
          <>
            <FormField label="Session" htmlFor={sessionFieldId}>
              <ChoiceInput
                inputId={sessionFieldId}
                layout="popover"
                value={sessionId ? String(sessionId) : ''}
                onChange={(value) => {
                  const next = Array.isArray(value) ? value[0] : value;
                  if (!next) return;
                  setSessionId(next);
                }}
                options={sessionOptions}
                placeholder="Select session"
              />
            </FormField>
            <FormField label="Search" htmlFor={searchFieldId}>
              <input
                id={searchFieldId}
                className="app-input"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  setFilter('search', searchDraft);
                }}
                placeholder="Name, email, league, or membership"
              />
            </FormField>
            <FormField label="Balance" htmlFor={balanceFieldId}>
              <ChoiceInput
                inputId={balanceFieldId}
                layout="popover"
                value={BALANCE_FILTER_OPTIONS.some((option) => option.value === balanceFilter) ? balanceFilter : 'all'}
                onChange={(value) => {
                  const next = Array.isArray(value) ? value[0] : value;
                  if (!next) return;
                  setFilter('balance', next);
                }}
                options={BALANCE_FILTER_OPTIONS}
              />
            </FormField>
            <FormField label="Email status" htmlFor={sentFieldId}>
              <ChoiceInput
                inputId={sentFieldId}
                layout="popover"
                value={SENT_FILTER_OPTIONS.some((option) => option.value === sentFilter) ? sentFilter : 'all'}
                onChange={(value) => {
                  const next = Array.isArray(value) ? value[0] : value;
                  if (!next) return;
                  setFilter('sent', next);
                }}
                options={SENT_FILTER_OPTIONS}
              />
            </FormField>
            <FormField label="Assistance" htmlFor={assistanceFieldId}>
              <ChoiceInput
                inputId={assistanceFieldId}
                layout="popover"
                value={
                  ASSISTANCE_FILTER_OPTIONS.some((option) => option.value === assistanceFilter)
                    ? assistanceFilter
                    : 'all'
                }
                onChange={(value) => {
                  const next = Array.isArray(value) ? value[0] : value;
                  if (!next) return;
                  setFilter('assistance', next);
                }}
                options={ASSISTANCE_FILTER_OPTIONS}
              />
            </FormField>
          </>
        }
        right={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={sendBusy || selectedToHold.length === 0}
              onClick={() => setHeldMany(selectedToHold.map((row) => row.memberId), true)}
            >
              {`Hold selected${selectedToHold.length ? ` (${selectedToHold.length})` : ''}`}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={sendBusy || selectedToRelease.length === 0}
              onClick={() => setHeldMany(selectedToRelease.map((row) => row.memberId), false)}
            >
              {`Release selected${selectedToRelease.length ? ` (${selectedToRelease.length})` : ''}`}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={sendBusy || !sessionId || payload?.leagueProcessingActive || selectedSendable.length === 0}
              onClick={() =>
                void sendEmails(
                  selectedSendable.map((row) => row.memberId),
                  selectedSendable.length > 0 && selectedReminders.length === selectedSendable.length
                    ? 'unpaid'
                    : 'selected',
                )
              }
            >
              {sendBusy ? 'Sending…' : `Send selected${selectedSendable.length ? ` (${selectedSendable.length})` : ''}`}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={sendBusy || !sessionId || payload?.leagueProcessingActive || unpaidReminderMemberIds.length === 0}
              onClick={() => void sendEmails(unpaidReminderMemberIds, 'unpaid')}
            >
              {sendBusy
                ? 'Sending…'
                : `Send unpaid${unpaidReminderMemberIds.length ? ` (${unpaidReminderMemberIds.length})` : ''}`}
            </Button>
            <Button
              type="button"
              disabled={sendBusy || !sessionId || payload?.leagueProcessingActive || sendAllMemberIds.length === 0}
              onClick={() => void sendEmails(sendAllMemberIds, 'unsent')}
            >
              {sendBusy ? 'Sending…' : `Send all unsent${sendAllMemberIds.length ? ` (${sendAllMemberIds.length})` : ''}`}
            </Button>
          </>
        }
      />

      {loading ? (
        <AppStateCard title="Loading roster emails" description="Loading members and billing summaries." />
      ) : null}

      {error ? (
        <AppStateCard
          title="Unable to load roster emails"
          description={error}
          action={<Button onClick={() => void loadRecipients()}>Try again</Button>}
        />
      ) : null}

      {!loading && !error && sessionId ? (
        <section className="space-y-4">
          <div>
            <h2 className="app-section-title">Roster confirmation emails</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {payload
                ? `${payload.recipients.length} ${payload.recipients.length === 1 ? 'member' : 'members'}. Open a name to read the email that would be sent.`
                : 'Preview and send league roster confirmation emails.'}
            </p>
            {payload?.recipients.some((row) => row.leagues.some((league) => league.isTemporarySabbaticalFill)) ? (
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                * Temporary sabbatical-fill spot.
              </p>
            ) : null}
            {pendingAssistanceCount > 0 ? (
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                {pendingAssistanceCount === 1
                  ? '1 Junior Recreational financial assistance request needs review before that invoice can be sent.'
                  : `${pendingAssistanceCount} Junior Recreational financial assistance requests need review before those invoices can be sent.`}
              </p>
            ) : null}
            {heldUnsentCount > 0 ? (
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                {heldUnsentCount === 1
                  ? '1 email is held and will be skipped by Send all unsent. You can still send it with Send selected.'
                  : `${heldUnsentCount} emails are held and will be skipped by Send all unsent. You can still send them with Send selected.`}
              </p>
            ) : null}
            {unpaidReminderMemberIds.length > 0 ? (
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                {unpaidReminderMemberIds.length === 1
                  ? '1 member still owes and can receive a payment reminder that reuses their existing payment link.'
                  : `${unpaidReminderMemberIds.length} members still owe and can receive payment reminders that reuse their existing payment links.`}
              </p>
            ) : null}
            {payload?.leagueProcessingActive ? (
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                League processing is on, so these emails cannot be sent until it is turned off.
              </p>
            ) : null}
            {sendJob?.status === 'running' ? (
              <div className="app-card mt-4 p-4 space-y-2" role="status" aria-live="polite">
                <div className="flex items-center justify-between text-sm text-gray-700 dark:text-gray-300">
                  <span className="font-medium">
                    {rosterConfirmationSendProgressLabel(rosterConfirmationSendProgressFromJob(sendJob), sendJob.status)}
                  </span>
                  <span>{rosterConfirmationSendProgressPercent(rosterConfirmationSendProgressFromJob(sendJob))}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    className="h-full rounded-full bg-primary-teal transition-all duration-200"
                    style={{
                      width: `${rosterConfirmationSendProgressPercent(rosterConfirmationSendProgressFromJob(sendJob))}%`,
                    }}
                  />
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {sendJob.sent} sent
                  {sendJob.failed > 0 ? `, ${sendJob.failed} could not be sent` : ''}. You can leave or refresh this
                  page; sending continues on the server.
                </p>
              </div>
            ) : null}
          </div>
          <DataTable
            columns={columns}
            rows={pagedRows}
            rowKey={(row) => row.memberId}
            sort={sort}
            onSortChange={(nextSort) => {
              setSort(nextSort);
            }}
            selection={{
              selectedIds,
              getRowLabel: (row) => row.memberName,
              isRowSelectable: (row) => row.canSend,
              onToggleRow: (row, checked) => {
                setSelectedIds((current) =>
                  checked ? Array.from(new Set([...current, row.memberId])) : current.filter((id) => id !== row.memberId),
                );
              },
              onTogglePage: (rows, checked) => {
                const ids = rows.filter((row) => row.canSend).map((row) => row.memberId);
                setSelectedIds((current) =>
                  checked ? Array.from(new Set([...current, ...ids])) : current.filter((id) => !ids.includes(id)),
                );
              },
            }}
            emptyState={
              <AppStateCard
                compact
                title="No members found"
                description="Try another session, search, or filter."
              />
            }
            pagination={{
              page: currentPage,
              pageSize: PAGE_SIZE,
              totalRecords: filteredRows.length,
              currentCount: pagedRows.length,
              onPageChange: setPage,
            }}
            actions={{
              header: 'Actions',
              widthClassName: 'w-[12.5rem]',
              renderActions: (row) => (
                <div className="flex flex-wrap justify-end gap-2">
                  {canReviewFinancialAssistance(row.financialAssistance) ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="!px-3 !py-1.5"
                      disabled={sendBusy}
                      onClick={() => {
                        setReviewError(null);
                        setReviewTarget(row);
                      }}
                      aria-label={`Review financial assistance for ${row.memberName}`}
                    >
                      Review
                    </Button>
                  ) : null}
                  {canHoldRosterConfirmationEmail(row) ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="!px-3 !py-1.5"
                      disabled={sendBusy}
                      onClick={() => setHeld(row.memberId, !heldSet.has(row.memberId))}
                      aria-label={
                        heldSet.has(row.memberId)
                          ? `Release held email for ${row.memberName}`
                          : `Hold email for ${row.memberName}`
                      }
                    >
                      {heldSet.has(row.memberId) ? 'Release' : 'Hold'}
                    </Button>
                  ) : null}
                </div>
              ),
            }}
          />
        </section>
      ) : null}

      {reviewTarget && canReviewFinancialAssistance(reviewTarget.financialAssistance) ? (
        <ReviewFinancialAssistanceModal
          isOpen
          saving={reviewSaving}
          memberName={reviewTarget.memberName}
          assistance={reviewTarget.financialAssistance}
          error={reviewError}
          onClose={() => {
            if (reviewSaving) return;
            setReviewTarget(null);
            setReviewError(null);
          }}
          onSubmit={(input) => {
            void saveAssistanceReview(input);
          }}
        />
      ) : null}
    </>
  );
}
