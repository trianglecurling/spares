import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { get, post } from '../../api/client';
import type { paths } from '../../api/generated/types';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import AppStateCard from '../../components/AppStateCard';
import Button from '../../components/Button';
import ChoiceInput from '../../components/ChoiceInput';
import FormField from '../../components/FormField';
import Modal from '../../components/Modal';
import DataTable from '../../components/table/DataTable';
import type { DataTableColumn } from '../../components/table/tableTypes';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import useTableQueryState from '../../hooks/useTableQueryState';
import { getApiErrorMessage } from '../../utils/api';
import { formatClubDateTime } from '../../utils/clubTime';
import { PARENT_ORG_URLS } from '../../utils/parentOrganizations';

type OrgRostersPayload = paths['/members/org-rosters']['get']['responses']['200']['content']['application/json'];
type OrgRosterMember = OrgRostersPayload['members'][number];

type RosterFilter = 'all' | 'usa-curling' | 'uswca' | 'missing-number';
type SortKey = 'name';

const PAGE_SIZE = 50;
const SORT_KEYS = ['name'] as const;

const ROSTER_FILTER_OPTIONS: Array<{ value: RosterFilter; label: string }> = [
  { value: 'all', label: 'All current members' },
  { value: 'usa-curling', label: 'USA Curling roster' },
  { value: 'uswca', label: 'USWCA roster' },
  { value: 'missing-number', label: 'Missing USA Curling number' },
];

const USA_CURLING_COLUMNS = [
  'Email',
  'First Name',
  'Last Name',
  'Gender',
  'DOB',
  'Membership Number Look Up',
  'Valid From',
  'Clubs',
  'Membership Type',
  'Primary Contact Number',
  'Are you currently serving in the US Military?',
  'Branch?',
];

const USWCA_COLUMNS = ['Last name', 'First name', 'Email'];

function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No';
}

function matchesRosterFilter(member: OrgRosterMember, filter: RosterFilter): boolean {
  if (filter === 'usa-curling') return member.usaCurlingOptIn;
  if (filter === 'uswca') return member.uswcaOptIn;
  if (filter === 'missing-number') return member.missingUsaCurlingNumber;
  return true;
}

function formatDateOnlyLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function lastSendSummary(payload: OrgRostersPayload): string | null {
  if (!payload.lastConfirmationEmailsQueuedAt) return null;
  const sentAt = formatClubDateTime(payload.lastConfirmationEmailsQueuedAt);
  const queued = payload.lastConfirmationEmailsQueuedCount;
  const queuedLabel = queued == null ? sentAt : `${sentAt} (${queued} queued)`;
  if (!payload.lastConfirmationEmailsConfirmByDate) return queuedLabel;
  return `${queuedLabel}. Confirm by was ${formatDateOnlyLabel(payload.lastConfirmationEmailsConfirmByDate)}`;
}

export default function AdminOrgRosters() {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const searchFieldId = useId();
  const rosterFilterFieldId = useId();
  const confirmByFieldId = useId();
  const tsvFieldId = useId();
  const { page, setPage, filters, setFilter, draftFilters, setDraftFilter } = useTableQueryState<
    SortKey,
    { search: string; roster: string }
  >({
    defaultSort: { key: 'name', direction: 'asc' },
    sortKeys: SORT_KEYS,
    filterConfig: {
      search: { queryKey: 'search', defaultValue: '', debounceMs: 300 },
      roster: {
        queryKey: 'roster',
        defaultValue: 'all',
        parse: (raw) =>
          raw && ['usa-curling', 'uswca', 'missing-number'].includes(raw) ? raw : 'all',
      },
    },
  });
  const [payload, setPayload] = useState<OrgRostersPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmByDate, setConfirmByDate] = useState('');
  const [sending, setSending] = useState(false);
  const [exportTitle, setExportTitle] = useState('');
  const [exportTsv, setExportTsv] = useState('');
  const [exportOpen, setExportOpen] = useState(false);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const data = await get('/members/org-rosters');
      setPayload(data);
      setConfirmByDate((current) => current || data.generatedOn);
    } catch (loadError) {
      if (!options?.silent) {
        setError(getApiErrorMessage(loadError, 'Could not load org rosters.'));
      }
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rosterFilter = (
    ['all', 'usa-curling', 'uswca', 'missing-number'].includes(filters.roster) ? filters.roster : 'all'
  ) as RosterFilter;
  const search = filters.search.trim().toLowerCase();

  const filteredMembers = useMemo(() => {
    const members = payload?.members ?? [];
    return members.filter((member) => {
      if (!matchesRosterFilter(member, rosterFilter)) return false;
      if (!search) return true;
      const haystack = [member.name, member.email, member.usaCurlingMembershipNumber]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(search);
    });
  }, [payload?.members, rosterFilter, search]);

  const pagedMembers = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredMembers.slice(start, start + PAGE_SIZE);
  }, [filteredMembers, page]);

  const columns: Array<DataTableColumn<OrgRosterMember, SortKey>> = useMemo(
    () => [
      {
        id: 'name',
        header: 'Member',
        renderCell: (row) => (
          <div>
            <div>{row.name}</div>
            {row.email ? (
              <div className="text-xs text-gray-500 dark:text-gray-400">{row.email}</div>
            ) : (
              <div className="text-xs text-amber-700 dark:text-amber-400">No email</div>
            )}
          </div>
        ),
      },
      {
        id: 'usa-curling',
        header: 'USA Curling',
        renderCell: (row) => yesNo(row.usaCurlingOptIn),
      },
      {
        id: 'uswca',
        header: 'USWCA',
        renderCell: (row) => yesNo(row.uswcaOptIn),
      },
      {
        id: 'membership-type',
        header: 'USA Curling type',
        renderCell: (row) => (row.usaCurlingOptIn ? row.usaCurlingMembershipType : '—'),
      },
      {
        id: 'membership-number',
        header: 'USA Curling number',
        renderCell: (row) => {
          if (!row.usaCurlingOptIn) return '—';
          if (row.usaCurlingMembershipNumber) return row.usaCurlingMembershipNumber;
          return <span className="text-amber-700 dark:text-amber-400">Missing</span>;
        },
      },
    ],
    [],
  );

  const openExport = (title: string, tsv: string) => {
    if (!tsv) {
      showAlert('There are no rows to copy for this roster.', 'warning');
      return;
    }
    setExportTitle(title);
    setExportTsv(tsv);
    setExportOpen(true);
  };

  const handleCopyTsv = async () => {
    try {
      await navigator.clipboard.writeText(exportTsv);
      showAlert('TSV copied to clipboard.', 'success');
    } catch (copyError) {
      console.error('Failed to copy TSV:', copyError);
      showAlert('Failed to copy TSV.', 'error');
    }
  };

  const handleSendConfirmation = async () => {
    if (!confirmByDate) {
      showAlert('Choose a confirmation date first.', 'warning');
      return;
    }
    const currentCount = payload?.currentMemberCount ?? 0;
    const lastSent = payload ? lastSendSummary(payload) : null;
    const lastSentLine = lastSent
      ? ` Last sent ${lastSent}.`
      : ' These confirmation emails have not been sent yet.';
    const confirmed = await confirm({
      title: 'Send parent org confirmation emails',
      message: `Send this email to all ${currentCount} current members? Each message includes their current USA Curling and USWCA choices and asks them to confirm by ${confirmByDate}.${lastSentLine} Emails send in the background after you confirm.`,
      variant: 'info',
      confirmText: 'Send emails',
    });
    if (!confirmed) return;
    setSending(true);
    try {
      const result = await post('/members/org-rosters/confirmation-emails', { confirmByDate });
      const skipped =
        result.skippedNoEmail > 0 ? ` ${result.skippedNoEmail} without an email were skipped.` : '';
      showAlert(
        `Queued ${result.queued} confirmation emails.${skipped} They send in the background; this page records the send time.`,
        'success',
      );
      await load({ silent: true });
    } catch (sendError) {
      showAlert(getApiErrorMessage(sendError, 'Could not send confirmation emails.'), 'error');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return <AppStateCard title="Loading org rosters…" />;
  }

  if (error) {
    return (
      <AppStateCard
        title="Could not load org rosters"
        description={error}
        action={
          <Button type="button" onClick={() => void load()}>
            Try again
          </Button>
        }
      />
    );
  }

  if (!payload || payload.currentMemberCount === 0) {
    return (
      <AppStateCard
        title="No current members"
        description="Org rosters include members with an active or pending season membership, plus lifetime members."
      />
    );
  }

  const lastSent = lastSendSummary(payload);

  return (
    <>
      <AppPageControlsRow
        right={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => openExport('USA Curling roster (TSV)', payload.usaCurlingTsv)}
            >
              Copy USA Curling TSV
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => openExport('USWCA roster (TSV)', payload.uswcaTsv)}
            >
              Copy USWCA TSV
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="app-card space-y-3">
          <h2 className="app-section-title">Request confirmation</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Emails all current members with their current USA Curling and USWCA choices and a link to{' '}
            <span className="whitespace-nowrap">Profile → Parent organizations</span>. GNCC is listed as required.
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Messages are queued and sent in the background. There is no completion notice; use the last-sent time
            below so this is not sent too often.
          </p>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {lastSent ? `Last sent ${lastSent}.` : 'These confirmation emails have not been sent yet.'}
          </p>
          <FormField label="Confirm by" htmlFor={confirmByFieldId} required>
            <input
              id={confirmByFieldId}
              type="date"
              className="app-input"
              value={confirmByDate}
              min={payload.generatedOn}
              onChange={(event) => setConfirmByDate(event.target.value)}
            />
          </FormField>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Subject: Action requested: confirm your parent org memberships
          </p>
          <Button type="button" onClick={() => void handleSendConfirmation()} disabled={sending}>
            {sending ? 'Sending…' : 'Send confirmation emails'}
          </Button>
        </section>

        <section className="app-card space-y-3">
          <h2 className="app-section-title">Current members</h2>
          <ul className="text-sm text-gray-700 dark:text-gray-300">
            <li>{payload.currentMemberCount} current members</li>
            <li>{payload.usaCurlingCount} opted in to USA Curling</li>
            <li>{payload.uswcaCount} opted in to USWCA</li>
            <li>{payload.missingUsaCurlingNumberCount} USA Curling rows missing a membership number</li>
          </ul>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="app-card space-y-3">
          <h2 className="app-section-title">USA Curling columns</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Copy the TSV and paste into the first data row of the USA Curling template. Column order:
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-700 dark:text-gray-300">
            {USA_CURLING_COLUMNS.map((column) => (
              <li key={column}>{column}</li>
            ))}
          </ol>
        </section>
        <section className="app-card space-y-3">
          <h2 className="app-section-title">USWCA columns</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Copy the TSV and paste into the first data row of the USWCA template. Column order:
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-700 dark:text-gray-300">
            {USWCA_COLUMNS.map((column) => (
              <li key={column}>{column}</li>
            ))}
          </ol>
          <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
            <h3 className="app-section-title">GNCC</h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              GNCC roster export is not available yet. Membership is required for every current member.
            </p>
          </div>
        </section>
      </div>

      <p className="text-sm text-gray-600 dark:text-gray-400">
        Parent org websites:{' '}
        <a className="text-primary-teal-link hover:underline" href={PARENT_ORG_URLS.usaCurling} target="_blank" rel="noopener noreferrer">
          USA Curling
        </a>
        ,{' '}
        <a className="text-primary-teal-link hover:underline" href={PARENT_ORG_URLS.gncc} target="_blank" rel="noopener noreferrer">
          GNCC
        </a>
        ,{' '}
        <a className="text-primary-teal-link hover:underline" href={PARENT_ORG_URLS.uswca} target="_blank" rel="noopener noreferrer">
          USWCA
        </a>
        .
      </p>

      <AppPageControlsRow
        left={
          <div className="flex w-full flex-col gap-3 lg:flex-row lg:items-end lg:gap-4">
            <FormField label="Filter members" htmlFor={searchFieldId} className="min-w-[16rem] flex-1">
              <input
                id={searchFieldId}
                type="search"
                className="app-input"
                value={draftFilters.search}
                onChange={(event) => setDraftFilter('search', event.target.value)}
                placeholder="Search name, email, or membership number"
              />
            </FormField>
            <FormField label="Roster" htmlFor={rosterFilterFieldId} className="min-w-[16rem]">
              <ChoiceInput
                inputId={rosterFilterFieldId}
                layout="popover"
                value={
                  ROSTER_FILTER_OPTIONS.some((option) => option.value === rosterFilter)
                    ? rosterFilter
                    : 'all'
                }
                onChange={(value) => {
                  const next = Array.isArray(value) ? value[0] : value;
                  if (!next) return;
                  setFilter('roster', next);
                }}
                options={ROSTER_FILTER_OPTIONS}
              />
            </FormField>
          </div>
        }
      />

      <DataTable
        rows={pagedMembers}
        rowKey={(member) => member.id}
        columns={columns}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          totalRecords: filteredMembers.length,
          currentCount: pagedMembers.length,
          onPageChange: setPage,
        }}
        emptyState={
          <AppStateCard
            compact
            title="No members match these filters"
            description="Clear the search or roster filter to see all current members."
          />
        }
      />

      <Modal isOpen={exportOpen} onClose={() => setExportOpen(false)} title={exportTitle} size="xl">
        <div className="flex h-full min-h-0 flex-col space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Copy these rows and paste them into the first data row of the template spreadsheet. Header row is omitted.
          </p>
          <FormField label="Roster rows" htmlFor={tsvFieldId} className="flex min-h-0 flex-1 flex-col">
            <textarea
              id={tsvFieldId}
              className="app-input min-h-0 flex-1 font-mono text-xs"
              value={exportTsv}
              readOnly
            />
          </FormField>
          <div className="flex justify-end space-x-3">
            <Button type="button" variant="secondary" onClick={() => setExportOpen(false)}>
              Close
            </Button>
            <Button type="button" onClick={() => void handleCopyTsv()}>
              Copy TSV
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
