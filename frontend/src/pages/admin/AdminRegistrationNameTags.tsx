import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { get } from '../../api/client';
import type { paths } from '../../api/generated/types';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import AppStateCard from '../../components/AppStateCard';
import Button from '../../components/Button';
import ChoiceInput from '../../components/ChoiceInput';
import FormField from '../../components/FormField';
import Modal from '../../components/Modal';
import DataTable from '../../components/table/DataTable';
import type { DataTableColumn, TableSort } from '../../components/table/tableTypes';
import { useAlert } from '../../contexts/AlertContext';
import api, { getApiErrorMessage } from '../../utils/api';
import { buildNameTagTsv, formatIncludePronouns, nameTagKindLabel } from './nameTagExport';

type RegistrationSession = {
  id: number;
  seasonId: number;
  seasonName: string;
  name: string;
  isDefault: boolean;
};

type NameTagsPayload = paths['/registration/staff/name-tags']['get']['responses']['200']['content']['application/json'];
type NameTagRow = NameTagsPayload['nameTags'][number];
type NameTagSortKey = 'name' | 'quantity' | 'type';

const PAGE_SIZE = 50;

export default function AdminRegistrationNameTags() {
  const { showAlert } = useAlert();
  const sessionFieldId = useId();
  const searchFieldId = useId();
  const exportFieldId = useId();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sessions, setSessions] = useState<RegistrationSession[]>([]);
  const [defaultSessionId, setDefaultSessionId] = useState<number | null>(null);
  const [payload, setPayload] = useState<NameTagsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportTsv, setExportTsv] = useState('');

  const sessionId = Number(searchParams.get('sessionId')) || defaultSessionId;
  const [search, setSearch] = useState('');
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const sortKey = (['name', 'quantity', 'type'] as const).includes(searchParams.get('sort') as NameTagSortKey)
    ? (searchParams.get('sort') as NameTagSortKey)
    : 'name';
  const rawOrder = searchParams.get('order');
  const sortDirection = rawOrder === 'asc' || rawOrder === 'desc' ? rawOrder : 'asc';
  const sort: TableSort<NameTagSortKey> = { key: sortKey, direction: sortDirection };

  const setQuery = useCallback(
    (updates: Record<string, string>) => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(updates)) {
        if (!value) next.delete(key);
        else next.set(key, value);
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const loadSessions = useCallback(async () => {
    const response = await api.get<{ sessions: RegistrationSession[]; defaultSessionId: number | null }>(
      '/registration/staff/sessions',
    );
    setSessions(response.data.sessions);
    setDefaultSessionId(response.data.defaultSessionId);
    if (!searchParams.get('sessionId') && response.data.defaultSessionId) {
      setQuery({ sessionId: String(response.data.defaultSessionId) });
    }
  }, [searchParams, setQuery]);

  const loadNameTags = useCallback(async () => {
    if (!sessionId) {
      setLoading(false);
      setPayload(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await get('/registration/staff/name-tags', { sessionId });
      setPayload(data);
    } catch (err) {
      setPayload(null);
      setError(getApiErrorMessage(err, 'Unable to load name tags.'));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void loadSessions().catch((err) => setError(getApiErrorMessage(err, 'Unable to load sessions.')));
  }, [loadSessions]);

  useEffect(() => {
    void loadNameTags();
  }, [loadNameTags]);

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
    const rows = (payload?.nameTags ?? []).filter((row) => {
      if (!needle) return true;
      return (
        row.nameTagName.toLowerCase().includes(needle) ||
        row.curlerName.toLowerCase().includes(needle) ||
        (row.pronouns ?? '').toLowerCase().includes(needle) ||
        nameTagKindLabel(row.kind).toLowerCase().includes(needle) ||
        String(row.quantity).includes(needle)
      );
    });
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((left, right) => {
      if (sort.key === 'quantity') {
        const quantityDiff = left.quantity - right.quantity;
        if (quantityDiff !== 0) return quantityDiff * direction;
      }
      if (sort.key === 'type') {
        const typeDiff = nameTagKindLabel(left.kind).localeCompare(nameTagKindLabel(right.kind));
        if (typeDiff !== 0) return typeDiff * direction;
      }
      const nameDiff = left.nameTagName.localeCompare(right.nameTagName);
      if (nameDiff !== 0) return nameDiff * (sort.key === 'name' ? direction : 1);
      return left.registrationId - right.registrationId;
    });
  }, [payload?.nameTags, search, sort.direction, sort.key]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const totalQuantity = filteredRows.reduce((sum, row) => sum + row.quantity, 0);
  const newMemberCount = filteredRows.filter((row) => row.kind === 'new_member').length;
  const replacementCount = filteredRows.filter((row) => row.kind === 'paid_replacement').length;

  const openExport = () => {
    if (filteredRows.length === 0) {
      showAlert('No name tags to export.', 'warning');
      return;
    }
    setExportTsv(buildNameTagTsv(filteredRows));
    setExportOpen(true);
  };

  const copyExport = async () => {
    try {
      await navigator.clipboard.writeText(exportTsv);
      showAlert('TSV copied to clipboard.', 'success');
    } catch {
      showAlert('Failed to copy TSV.', 'error');
    }
  };

  const columns: Array<DataTableColumn<NameTagRow, NameTagSortKey>> = [
    {
      id: 'name',
      header: 'Name tag name',
      sortable: true,
      sortKey: 'name',
      renderCell: (row) => (
        <div>
          <Link
            to={`/admin/registrations/${row.registrationId}`}
            className="font-medium text-primary-teal-link hover:underline"
          >
            {row.nameTagName || '—'}
          </Link>
          {row.curlerName && row.curlerName !== row.nameTagName ? (
            <div className="text-xs text-gray-500 dark:text-gray-400">{row.curlerName}</div>
          ) : null}
        </div>
      ),
    },
    {
      id: 'includePronouns',
      header: 'Include pronouns',
      renderCell: (row) => formatIncludePronouns(row.includePronouns),
    },
    {
      id: 'pronouns',
      header: 'Pronouns',
      renderCell: (row) => (row.includePronouns && row.pronouns ? row.pronouns : '—'),
    },
    {
      id: 'quantity',
      header: 'Quantity',
      sortable: true,
      sortKey: 'quantity',
      align: 'right',
      renderCell: (row) => <span className="tabular-nums">{row.quantity}</span>,
    },
    {
      id: 'type',
      header: 'Type',
      sortable: true,
      sortKey: 'type',
      renderCell: (row) => nameTagKindLabel(row.kind),
    },
  ];

  const summary = !payload
    ? 'Name tags to print for the selected session.'
    : payload.nameTags.length === 0
      ? 'No name tags to make for this session.'
      : filteredRows.length === 0
        ? 'No name tags match this search.'
        : `${totalQuantity} ${totalQuantity === 1 ? 'name tag' : 'name tags'} to print${search.trim() ? ' matching this search' : ''}, from ${newMemberCount} ${newMemberCount === 1 ? 'new member' : 'new members'} and ${replacementCount} ${replacementCount === 1 ? 'paid replacement' : 'paid replacements'}.`;

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
                  setQuery({ sessionId: next, page: '' });
                }}
                options={sessionOptions}
                placeholder="Select session"
              />
            </FormField>
            <FormField label="Search" htmlFor={searchFieldId}>
              <input
                id={searchFieldId}
                className="app-input"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  if (page > 1) setQuery({ page: '' });
                }}
                placeholder="Name, pronouns, or type"
              />
            </FormField>
          </>
        }
        right={
          <Button type="button" variant="secondary" onClick={openExport} disabled={loading || filteredRows.length === 0}>
            Export TSV
          </Button>
        }
      />

      {loading ? <AppStateCard title="Loading name tags" description="Collecting name tags for this session." /> : null}

      {error ? (
        <AppStateCard
          title="Unable to load name tags"
          description={error}
          action={
            <Button type="button" onClick={() => void loadNameTags()}>
              Try again
            </Button>
          }
        />
      ) : null}

      {!loading && !error && !sessionId ? (
        <AppStateCard title="Select a session" description="Choose a registration session to see which name tags to make." />
      ) : null}

      {!loading && !error && sessionId ? (
        <section className="space-y-4">
          <div>
            <h2 className="app-section-title">Name tags</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{summary}</p>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              New members are included after they submit. Returning members are included only after payments cover the
              replacement they ordered. Unpaid league fees do not remove a covered replacement.
            </p>
          </div>
          <DataTable
            columns={columns}
            rows={pagedRows}
            rowKey={(row) => row.registrationId}
            sort={sort}
            onSortChange={(nextSort) => {
              setQuery({
                sort: nextSort.key === 'name' ? '' : nextSort.key,
                order: nextSort.direction === 'asc' ? '' : nextSort.direction,
                page: '',
              });
            }}
            emptyState={
              <AppStateCard
                compact
                title={payload && payload.nameTags.length === 0 ? 'No name tags to make' : 'No matching name tags'}
                description={
                  payload && payload.nameTags.length === 0
                    ? 'Submitted new members and paid replacement orders will show up here.'
                    : 'Try a different search.'
                }
              />
            }
            pagination={{
              page: currentPage,
              pageSize: PAGE_SIZE,
              totalRecords: filteredRows.length,
              currentCount: pagedRows.length,
              onPageChange: (nextPage) => setQuery({ page: nextPage <= 1 ? '' : String(nextPage) }),
            }}
          />
        </section>
      ) : null}

      <Modal isOpen={exportOpen} onClose={() => setExportOpen(false)} title="Export name tags (TSV)" size="xl">
        <div className="flex h-full min-h-0 flex-col space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Copy and paste this into a spreadsheet (tab-separated values). The export includes every name tag matching
            the current search, including rows on other pages.
          </p>
          <FormField label="Name tag TSV" htmlFor={exportFieldId} className="flex min-h-0 flex-1 flex-col">
            <textarea
              id={exportFieldId}
              className="app-input min-h-64 flex-1 font-mono text-xs"
              value={exportTsv}
              readOnly
            />
          </FormField>
          <div className="flex justify-end space-x-3">
            <Button type="button" variant="secondary" onClick={() => setExportOpen(false)}>
              Close
            </Button>
            <Button type="button" onClick={() => void copyExport()}>
              Copy TSV
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
