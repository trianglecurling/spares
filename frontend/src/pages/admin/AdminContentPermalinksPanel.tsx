import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { HiChartBar, HiCheck, HiClipboardDocument, HiInformationCircle, HiLink, HiPencilSquare, HiTrash } from 'react-icons/hi2';
import axios from 'axios';
import api from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import AppStateCard from '../../components/AppStateCard';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import FormField from '../../components/FormField';
import FormCheckbox from '../../components/FormCheckbox';
import DataTable from '../../components/table/DataTable';
import type { DataTableColumn } from '../../components/table/tableTypes';
import useTableQueryState from '../../hooks/useTableQueryState';

export type PermalinkAdminRow = {
  id: number;
  slug: string;
  label: string | null;
  notes: string | null;
  destinationUrl: string;
  destinationMayChange: boolean;
  /** Pre-migration (e.g. YOURLS) click total; included in totalHits / uniqueVisitors from the API. */
  legacyClickCount: number;
  createdAt: string;
  updatedAt: string;
  totalHits: number;
  uniqueVisitors: number;
  authenticatedHits: number;
};

type PermalinkStatsResponse = {
  permalink: Omit<PermalinkAdminRow, 'totalHits' | 'uniqueVisitors' | 'authenticatedHits'>;
  totalHits: number;
  uniqueVisitors: number;
  authenticatedHits: number;
  referrers: { domain: string; count: number }[];
};

type FieldErrors = Partial<Record<'slug' | 'destinationUrl' | 'label' | 'notes', string[]>>;

/** Matches admin permalink slug rules (see backend slugSchema). */
const SLUG_FORMAT_RE = /^[a-z0-9-]+$/;

/** Canonical slug for API / row lookup; null if trimmed input is not valid (e.g. uppercase or illegal characters). */
function normalizedSlugIfValid(raw: string): string | null {
  const t = raw.trim();
  if (t.length < 1 || t.length > 120 || !SLUG_FORMAT_RE.test(t)) return null;
  return t.toLowerCase();
}

function permalinkSlugFormatMessage(raw: string, modalActive: boolean): string | undefined {
  if (!modalActive || raw.length === 0) return undefined;
  const t = raw.trim();
  if (t.length === 0) return 'Use lowercase letters, numbers, and hyphens only.';
  if (t.length > 120) return 'Slug must be at most 120 characters.';
  if (!SLUG_FORMAT_RE.test(t)) return 'Use lowercase letters, numbers, and hyphens only.';
  return undefined;
}

function clientDestinationLooksFetchable(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (t.startsWith('/')) return true;
  try {
    const u = new URL(t);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

type SortDir = 'asc' | 'desc';
type SortColumnKey = 'created' | 'label' | 'slug' | 'hits';

function comparePermalinkRows(a: PermalinkAdminRow, b: PermalinkAdminRow, key: SortColumnKey, dir: SortDir): number {
  const sign = dir === 'asc' ? 1 : -1;
  let cmp = 0;
  if (key === 'created') {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    cmp = ta === tb ? 0 : ta < tb ? -1 : 1;
  } else if (key === 'label') {
    cmp = (a.label ?? '').localeCompare(b.label ?? '', undefined, { sensitivity: 'base' });
  } else if (key === 'slug') {
    cmp = a.slug.localeCompare(b.slug, undefined, { sensitivity: 'base' });
  } else {
    cmp = a.totalHits - b.totalHits;
  }
  if (cmp !== 0) return cmp * sign;
  return b.id - a.id;
}

/** Strong leftward fade under copy icons (matches gray-50 / gray-900 admin surfaces). */
const PERMALINK_COPY_SCRIM =
  'bg-[linear-gradient(270deg,rgb(249_250_251)_0%,rgb(249_250_251)_40%,rgba(249,250,251,0.95)_58%,rgba(249,250,251,0.48)_82%,transparent_100%)] dark:bg-[linear-gradient(270deg,rgb(17_24_39)_0%,rgb(17_24_39)_40%,rgba(17,24,39,0.95)_58%,rgba(17,24,39,0.48)_82%,transparent_100%)]';

function shortLinkForSlug(slug: string): string {
  if (typeof window === 'undefined') return `/go/${slug}`;
  return `${window.location.origin}/go/${slug}`;
}

/** Absolute URL for a site path (e.g. `/go/foo`) using the current host. */
function fullSiteUrl(pathFromRoot: string): string {
  const path = pathFromRoot.startsWith('/') ? pathFromRoot : `/${pathFromRoot}`;
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

const PERMALINKS_PAGE_SIZE = 25;
const PERMALINK_SORT_KEYS = ['created', 'label', 'slug', 'hits'] as const;

export default function AdminContentPermalinksPanel({
  rows,
  loading,
  onRefresh,
}: {
  rows: PermalinkAdminRow[];
  loading: boolean;
  onRefresh: () => Promise<void>;
}) {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const permalinkFilterInputId = useId();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PermalinkAdminRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [slug, setSlug] = useState('');
  const [destinationUrl, setDestinationUrl] = useState('');
  const [label, setLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [destinationMayChange, setDestinationMayChange] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  /** Row that already owns this slug (create), or another row when editing. */
  const [slugConflictRow, setSlugConflictRow] = useState<PermalinkAdminRow | null>(null);
  const [labelSuggestStatus, setLabelSuggestStatus] = useState<'idle' | 'loading'>('idle');

  const labelInputRef = useRef<HTMLInputElement>(null);
  const labelSuggestRequestIdRef = useRef(0);
  const labelSuggestAbortRef = useRef<AbortController | null>(null);
  const suggestFocusLabelAfterSuggestRef = useRef(false);
  const shouldFocusLabelInputWhileLoadingRef = useRef(false);
  const skipNextDestinationBlurSuggestRef = useRef(false);

  const [statsOpen, setStatsOpen] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [stats, setStats] = useState<PermalinkStatsResponse | null>(null);
  const permalinkFilterConfig = useMemo(
    () => ({
      query: {
        queryKey: 'plQuery',
        defaultValue: '',
        debounceMs: 250,
      },
    }),
    []
  );
  const {
    page,
    sort,
    draftFilters,
    setPage,
    setSort,
    setDraftFilter,
  } = useTableQueryState<SortColumnKey, { query: string }>({
    defaultSort: { key: 'created', direction: 'desc' },
    sortKeys: PERMALINK_SORT_KEYS,
    pageParam: 'plPage',
    sortParam: 'plSort',
    orderParam: 'plOrder',
    filterConfig: permalinkFilterConfig,
  });

  const filteredRows = useMemo(() => {
    const query = draftFilters.query.trim().toLowerCase();
    if (!query) return rows;

    return rows.filter((row) => {
      const haystack = [
        row.slug,
        row.label ?? '',
        row.destinationUrl,
        row.notes ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [draftFilters.query, rows]);

  const sortedRows = useMemo(
    () => [...filteredRows].sort((a, b) => comparePermalinkRows(a, b, sort.key, sort.direction)),
    [filteredRows, sort]
  );

  const pagedRows = useMemo(() => {
    const start = (page - 1) * PERMALINKS_PAGE_SIZE;
    return sortedRows.slice(start, start + PERMALINKS_PAGE_SIZE);
  }, [page, sortedRows]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(sortedRows.length / PERMALINKS_PAGE_SIZE));
    if (page > maxPage) {
      setPage(maxPage, { replace: true });
    }
  }, [page, setPage, sortedRows.length]);

  const slugFormatError = useMemo(() => permalinkSlugFormatMessage(slug, modalOpen), [slug, modalOpen]);

  const loadConflictRowForSlug = useCallback(
    async (normalized: string): Promise<PermalinkAdminRow | undefined> => {
      const local = rows.find((r) => r.slug === normalized);
      if (local) return local;
      try {
        const res = await api.get<PermalinkAdminRow[]>('/content/permalinks');
        return res.data.find((r) => r.slug === normalized);
      } catch {
        return undefined;
      }
    },
    [rows]
  );

  useEffect(() => {
    return () => {
      if (copyFeedbackClearRef.current) window.clearTimeout(copyFeedbackClearRef.current);
    };
  }, []);

  const cancelLabelSuggest = useCallback(() => {
    labelSuggestAbortRef.current?.abort();
    labelSuggestAbortRef.current = null;
    labelSuggestRequestIdRef.current += 1;
    suggestFocusLabelAfterSuggestRef.current = false;
    shouldFocusLabelInputWhileLoadingRef.current = false;
    setLabelSuggestStatus('idle');
  }, []);

  const maybeSuggestLabelFromDestination = useCallback(
    async (focusLabelWhenDone: boolean) => {
      if (saving) return;
      if (editing) return;
      if (label.trim().length > 0) return;
      const dest = destinationUrl.trim();
      if (!clientDestinationLooksFetchable(dest)) return;

      labelSuggestAbortRef.current?.abort();
      const ac = new AbortController();
      labelSuggestAbortRef.current = ac;
      const requestId = (labelSuggestRequestIdRef.current += 1);
      suggestFocusLabelAfterSuggestRef.current = focusLabelWhenDone;
      shouldFocusLabelInputWhileLoadingRef.current = focusLabelWhenDone;
      setLabelSuggestStatus('loading');

      try {
        const res = await api.post<{ title: string | null }>(
          '/content/permalinks/suggest-label',
          { url: dest },
          { signal: ac.signal }
        );
        if (labelSuggestRequestIdRef.current !== requestId) return;
        const t = res.data?.title?.trim();
        if (t) setLabel(t);
      } catch (err: unknown) {
        if (axios.isCancel(err)) return;
      } finally {
        if (labelSuggestRequestIdRef.current === requestId) {
          setLabelSuggestStatus('idle');
          const focusLabel = suggestFocusLabelAfterSuggestRef.current;
          suggestFocusLabelAfterSuggestRef.current = false;
          if (focusLabel) {
            requestAnimationFrame(() => labelInputRef.current?.focus());
          }
        }
      }
    },
    [saving, editing, label, destinationUrl]
  );

  useEffect(() => {
    if (labelSuggestStatus !== 'loading') return;
    if (!shouldFocusLabelInputWhileLoadingRef.current) return;
    shouldFocusLabelInputWhileLoadingRef.current = false;
    queueMicrotask(() => labelInputRef.current?.focus());
  }, [labelSuggestStatus]);

  useEffect(() => {
    if (!modalOpen || saving) return;
    const handle = window.setTimeout(() => {
      const norm = normalizedSlugIfValid(slug);
      if (norm == null) {
        setSlugConflictRow(null);
        return;
      }
      if (editing) {
        const other = rows.find((r) => r.slug === norm && r.id !== editing.id);
        setSlugConflictRow(other ?? null);
      } else {
        const found = rows.find((r) => r.slug === norm);
        setSlugConflictRow(found ?? null);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [modalOpen, slug, editing, rows, saving]);

  const switchToEditExisting = (row: PermalinkAdminRow) => {
    cancelLabelSuggest();
    setEditing(row);
    setSlug(row.slug);
    setDestinationUrl(row.destinationUrl);
    setLabel(row.label ?? '');
    setNotes(row.notes ?? '');
    setDestinationMayChange(row.destinationMayChange);
    setFieldErrors({});
    setSlugConflictRow(null);
  };

  const openCreate = () => {
    cancelLabelSuggest();
    setEditing(null);
    setSlug('');
    setDestinationUrl('');
    setLabel('');
    setNotes('');
    setDestinationMayChange(false);
    setFieldErrors({});
    setSlugConflictRow(null);
    setModalOpen(true);
  };

  const openEdit = (row: PermalinkAdminRow) => {
    cancelLabelSuggest();
    setEditing(row);
    setSlug(row.slug);
    setDestinationUrl(row.destinationUrl);
    setLabel(row.label ?? '');
    setNotes(row.notes ?? '');
    setDestinationMayChange(row.destinationMayChange);
    setFieldErrors({});
    setSlugConflictRow(null);
    setModalOpen(true);
  };

  const openStats = async (row: PermalinkAdminRow) => {
    setStats(null);
    setStatsOpen(true);
    setStatsLoading(true);
    try {
      const res = await api.get<PermalinkStatsResponse>(`/content/permalinks/${row.id}/stats`);
      setStats(res.data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to load stats', 'error');
      setStatsOpen(false);
    } finally {
      setStatsLoading(false);
    }
  };

  const parseFieldErrors = (details: unknown): FieldErrors => {
    if (!details || typeof details !== 'object') return {};
    const fe = (details as { fieldErrors?: Record<string, string[] | undefined> }).fieldErrors;
    if (!fe) return {};
    return {
      slug: fe.slug,
      destinationUrl: fe.destinationUrl,
      label: fe.label,
      notes: fe.notes,
    };
  };

  const handleSave = async () => {
    if (slugFormatError || slugConflictRow || labelSuggestStatus === 'loading') return;
    setSaving(true);
    setFieldErrors({});
    try {
      if (editing) {
        await api.patch(`/content/permalinks/${editing.id}`, {
          slug: slug.trim().toLowerCase(),
          destinationUrl: destinationUrl.trim(),
          label: label.trim() || null,
          notes: notes.trim() || null,
          destinationMayChange,
        });
        showAlert('Permalink updated', 'success');
      } else {
        await api.post('/content/permalinks', {
          slug: slug.trim().toLowerCase(),
          destinationUrl: destinationUrl.trim(),
          label: label.trim() || null,
          notes: notes.trim() || null,
          destinationMayChange,
        });
        showAlert('Permalink created', 'success');
      }
      setModalOpen(false);
      setSlugConflictRow(null);
      await onRefresh();
    } catch (err: unknown) {
      const ax = err as { response?: { status?: number; data?: { error?: string; details?: unknown } } };
      if (ax.response?.status === 400 && ax.response.data?.details) {
        setFieldErrors(parseFieldErrors(ax.response.data.details));
      } else if (ax.response?.status === 409) {
        const norm = slug.trim().toLowerCase();
        const conflict = await loadConflictRowForSlug(norm);
        if (conflict) {
          setSlugConflictRow(conflict);
        } else {
          showAlert(ax.response?.data?.error || 'This slug is not available.', 'error');
        }
      } else {
        const msg = ax.response?.data?.error;
        showAlert(msg || 'Could not save permalink', 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: PermalinkAdminRow) => {
    const ok = await confirm({
      title: 'Delete permalink',
      message: `Delete short link /go/${row.slug}? This cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/content/permalinks/${row.id}`);
      showAlert('Permalink deleted', 'success');
      await onRefresh();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to delete', 'error');
    }
  };

  const [copyFeedbackKey, setCopyFeedbackKey] = useState<string | null>(null);
  const copyFeedbackClearRef = useRef<number | null>(null);

  const copyWithInlineFeedback = useCallback(
    async (key: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        if (copyFeedbackClearRef.current) window.clearTimeout(copyFeedbackClearRef.current);
        setCopyFeedbackKey(key);
        copyFeedbackClearRef.current = window.setTimeout(() => {
          setCopyFeedbackKey((current) => (current === key ? null : current));
          copyFeedbackClearRef.current = null;
          // Click leaves focus on the button; focus-within keeps copy controls open after mouse leaves.
          const ae = document.activeElement;
          if (ae instanceof HTMLElement && ae.dataset.permalinkCopy === 'true') {
            ae.blur();
          }
        }, 1400);
      } catch {
        showAlert('Could not copy to clipboard', 'error');
      }
    },
    [showAlert]
  );

  const permalinkColumns: Array<DataTableColumn<PermalinkAdminRow, SortColumnKey>> = useMemo(
    () => [
      {
        id: 'created',
        header: 'Created',
        sortable: true,
        sortKey: 'created',
        defaultSortDirection: 'desc',
        cellClassName: 'whitespace-nowrap',
        renderCell: (row) => (
          <span title={row.createdAt}>
            {row.createdAt ? new Date(row.createdAt).toLocaleDateString() : '—'}
          </span>
        ),
      },
      {
        id: 'slug',
        header: 'Slug',
        sortable: true,
        sortKey: 'slug',
        defaultSortDirection: 'asc',
        cellClassName: 'min-w-0 max-w-xs',
        renderCell: (row) => (
          <div className="relative min-w-0">
            <code className="block min-w-0 truncate text-sm" title={row.slug}>
              {row.slug}
            </code>
            <div
              className={`pointer-events-none absolute inset-y-0 right-0 z-10 flex min-w-[4.5rem] items-center justify-end gap-0.5 pl-4 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 ${PERMALINK_COPY_SCRIM}`}
            >
              <button
                type="button"
                data-permalink-copy="true"
                className="pointer-events-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-primary-teal hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40"
                aria-label={`Copy short /go link for ${row.slug}`}
                title="Copy /go link"
                onClick={() => copyWithInlineFeedback(`${row.id}-go`, shortLinkForSlug(row.slug))}
              >
                {copyFeedbackKey === `${row.id}-go` ? (
                  <HiCheck className="h-4 w-4 text-green-600 dark:text-green-400" aria-hidden />
                ) : (
                  <HiLink className="h-4 w-4" aria-hidden />
                )}
              </button>
              <button
                type="button"
                data-permalink-copy="true"
                className="pointer-events-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-primary-teal hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40"
                aria-label={`Copy info page link for ${row.slug}`}
                title="Copy info link"
                onClick={() =>
                  copyWithInlineFeedback(`${row.id}-info`, `${shortLinkForSlug(row.slug)}/info`)
                }
              >
                {copyFeedbackKey === `${row.id}-info` ? (
                  <HiCheck className="h-4 w-4 text-green-600 dark:text-green-400" aria-hidden />
                ) : (
                  <HiInformationCircle className="h-4 w-4" aria-hidden />
                )}
              </button>
            </div>
          </div>
        ),
      },
      {
        id: 'label',
        header: 'Label',
        sortable: true,
        sortKey: 'label',
        defaultSortDirection: 'asc',
        cellClassName: 'min-w-0 max-w-xs',
        renderCell: (row) => (
          <div className="truncate font-medium" title={row.label?.trim() ? row.label : undefined}>
            {row.label || '—'}
          </div>
        ),
      },
      {
        id: 'destination',
        header: 'Destination',
        cellClassName: 'min-w-0 max-w-[12rem] text-gray-500 dark:text-gray-400',
        renderCell: (row) => (
          <div className="relative min-w-0">
            <span className="block min-w-0 truncate" title={row.destinationUrl}>
              {row.destinationUrl}
            </span>
            <div
              className={`pointer-events-none absolute inset-y-0 right-0 z-10 flex min-w-[4.75rem] items-center justify-end pl-4 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 ${PERMALINK_COPY_SCRIM}`}
            >
              <button
                type="button"
                data-permalink-copy="true"
                className="pointer-events-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-primary-teal hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40"
                aria-label="Copy destination URL"
                title="Copy destination URL"
                onClick={() => copyWithInlineFeedback(`${row.id}-dest`, row.destinationUrl)}
              >
                {copyFeedbackKey === `${row.id}-dest` ? (
                  <HiCheck className="h-4 w-4 text-green-600 dark:text-green-400" aria-hidden />
                ) : (
                  <HiClipboardDocument className="h-4 w-4" aria-hidden />
                )}
              </button>
            </div>
          </div>
        ),
      },
      {
        id: 'hits',
        header: 'Hits',
        sortable: true,
        sortKey: 'hits',
        defaultSortDirection: 'desc',
        cellClassName: 'tabular-nums',
        renderCell: (row) => row.totalHits,
      },
    ],
    [copyFeedbackKey, copyWithInlineFeedback]
  );

  if (loading) {
    return <AppStateCard title="Loading permalinks..." compact />;
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-gray-600 dark:text-gray-400 max-w-2xl space-y-1">
        <p>
          Short links redirect visitors from{' '}
          <code className="text-xs break-all">{fullSiteUrl('/go/your-slug')}</code> to any URL you choose.
        </p>
        <p>
          Use the info page at <code className="text-xs break-all">{fullSiteUrl('/go/your-slug/info')}</code> to show the
          destination without redirecting.
        </p>
      </div>

      <AppPageControlsRow
        left={(
          <FormField
            label="Filter permalinks"
            htmlFor={permalinkFilterInputId}
            className="min-w-[16rem] flex-1"
          >
            <input
              id={permalinkFilterInputId}
              type="search"
              className="app-input"
              value={draftFilters.query}
              onChange={(e) => setDraftFilter('query', e.target.value)}
              placeholder="Search any text field"
            />
          </FormField>
        )}
        right={(
          <Button type="button" variant="primary" onClick={openCreate}>
            Add permalink
          </Button>
        )}
      />

      <DataTable
        rows={pagedRows}
        rowKey={(row) => row.id}
        columns={permalinkColumns}
        sort={sort}
        onSortChange={setSort}
        actions={{
          widthClassName: 'w-[9rem]',
          renderActions: (row) => (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                className="inline-flex rounded text-primary-teal hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-primary-teal/40"
                aria-label={`Stats for ${row.slug}`}
                title="Stats"
                onClick={() => openStats(row)}
              >
                <HiChartBar className="h-5 w-5 shrink-0" aria-hidden />
              </button>
              <button
                type="button"
                className="inline-flex rounded text-primary-teal hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-primary-teal/40"
                aria-label={`Edit ${row.slug}`}
                title="Edit"
                onClick={() => openEdit(row)}
              >
                <HiPencilSquare className="h-5 w-5 shrink-0" aria-hidden />
              </button>
              <button
                type="button"
                className="inline-flex rounded text-red-600 hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-red-500/30 dark:text-red-400"
                aria-label={`Delete ${row.slug}`}
                title="Delete"
                onClick={() => handleDelete(row)}
              >
                <HiTrash className="h-5 w-5 shrink-0" aria-hidden />
              </button>
            </div>
          ),
        }}
        pagination={{
          page,
          pageSize: PERMALINKS_PAGE_SIZE,
          totalRecords: sortedRows.length,
          currentCount: pagedRows.length,
          onPageChange: setPage,
        }}
        emptyState={
          rows.length === 0 ? (
            <AppStateCard compact title="No permalinks yet." />
          ) : (
            <AppStateCard compact title="No permalinks match those filters." />
          )
        }
        getRowClassName={() => 'group/row'}
      />

      <Modal
        isOpen={modalOpen}
        onClose={() => {
          if (!saving) {
            cancelLabelSuggest();
            setSlugConflictRow(null);
            setModalOpen(false);
          }
        }}
        title={editing ? 'Edit permalink' : 'Add permalink'}
        size="lg"
      >
        <div className="space-y-4">
          <FormField
            label="Slug"
            required
            error={
              fieldErrors.slug?.[0] ??
              slugFormatError ??
              (slugConflictRow && !editing ? (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>This slug is already in use.</span>
                  <button
                    type="button"
                    className="font-medium text-primary-teal underline hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40 rounded"
                    onClick={() => switchToEditExisting(slugConflictRow)}
                  >
                    Edit that permalink instead?
                  </button>
                </span>
              ) : slugConflictRow && editing ? (
                'This slug is already used by another permalink.'
              ) : undefined)
            }
          >
            <input
              className="app-input"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setFieldErrors((fe) => {
                  if (!fe.slug) return fe;
                  const next = { ...fe };
                  delete next.slug;
                  return next;
                });
              }}
              placeholder="e.g. spring-signup"
              autoComplete="off"
              disabled={saving}
              aria-invalid={Boolean(fieldErrors.slug?.[0] || slugFormatError || slugConflictRow)}
            />
          </FormField>

          <FormField label="Destination URL" required error={fieldErrors.destinationUrl?.[0]}>
            <input
              className="app-input"
              value={destinationUrl}
              onChange={(e) => setDestinationUrl(e.target.value)}
              placeholder="https://… or /path on this site"
              autoComplete="off"
              disabled={saving}
              aria-invalid={Boolean(fieldErrors.destinationUrl?.[0])}
              onKeyDown={(e) => {
                if (saving || editing) return;
                if (e.key !== 'Tab' || e.shiftKey) return;
                if (label.trim().length > 0) return;
                const dest = destinationUrl.trim();
                if (!clientDestinationLooksFetchable(dest)) return;
                skipNextDestinationBlurSuggestRef.current = true;
                e.preventDefault();
                void maybeSuggestLabelFromDestination(true);
              }}
              onBlur={() => {
                if (skipNextDestinationBlurSuggestRef.current) {
                  skipNextDestinationBlurSuggestRef.current = false;
                  return;
                }
                if (saving || editing) return;
                if (label.trim().length > 0) return;
                void maybeSuggestLabelFromDestination(false);
              }}
            />
          </FormField>

          <FormField label="Label" error={fieldErrors.label?.[0]}>
            <input
              ref={labelInputRef}
              className={`app-input${labelSuggestStatus === 'loading' ? ' cursor-wait opacity-80' : ''}`}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={labelSuggestStatus === 'loading' ? 'Loading page title…' : undefined}
              readOnly={labelSuggestStatus === 'loading'}
              disabled={saving}
              aria-busy={labelSuggestStatus === 'loading'}
            />
          </FormField>

          <FormField label="Notes" error={fieldErrors.notes?.[0]}>
            <textarea
              className="app-input min-h-[4rem]"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional internal notes"
              disabled={saving}
            />
          </FormField>

          <FormCheckbox
            label="Destination URL may change later"
            checked={destinationMayChange}
            onChange={setDestinationMayChange}
            disabled={saving}
            helperText="This prevents browsers from caching the URL so that visitors are always redirected to the most up-to-date destination."
          />

          <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-600">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => void handleSave()}
              disabled={saving || labelSuggestStatus === 'loading' || Boolean(slugFormatError || slugConflictRow)}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={statsOpen}
        onClose={() => setStatsOpen(false)}
        title={stats?.permalink ? `Stats: ${stats.permalink.slug}` : 'Permalink stats'}
        size="lg"
      >
        {statsLoading ? (
          <p className="text-gray-500">Loading…</p>
        ) : stats ? (
          <div className="space-y-4">
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div className="app-card p-3">
                <dt className="app-label">Total hits</dt>
                <dd className="text-lg font-semibold tabular-nums">{stats.totalHits}</dd>
              </div>
              <div className="app-card p-3">
                <dt className="app-label">Unique visitors (cookie)</dt>
                <dd className="text-lg font-semibold tabular-nums">{stats.uniqueVisitors}</dd>
              </div>
              <div className="app-card p-3">
                <dt className="app-label">Hits with login token</dt>
                <dd className="text-lg font-semibold tabular-nums">{stats.authenticatedHits}</dd>
              </div>
            </dl>
            <div>
              <h3 className="app-section-title text-sm mb-2">Referrer host</h3>
              {stats.referrers.length === 0 ? (
                <p className="text-sm text-gray-500">No data yet.</p>
              ) : (
                <div className="overflow-x-auto border border-gray-200 dark:border-gray-600 rounded-md">
                  <table className="app-table w-full">
                    <thead>
                      <tr>
                        <th className="app-table-th">Domain</th>
                        <th className="app-table-th text-right">Hits</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.referrers.map((r) => (
                        <tr key={`${r.domain}-${r.count}`}>
                          <td className="app-table-td text-sm">{r.domain}</td>
                          <td className="app-table-td text-right tabular-nums">{r.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-xs text-gray-500 mt-2">
                (none) means no Referer header was sent (direct visits, privacy filters, or some apps).
              </p>
            </div>

            <div className="flex justify-end pt-2 border-t border-gray-200 dark:border-gray-600">
              <Button type="button" variant="secondary" onClick={() => setStatsOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
