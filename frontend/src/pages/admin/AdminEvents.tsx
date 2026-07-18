import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import AppStateCard from '../../components/AppStateCard';
import Button from '../../components/Button';
import IncludeArchivedToggle from '../../components/softDelete/IncludeArchivedToggle';
import SoftDeleteRowActions from '../../components/softDelete/SoftDeleteRowActions';
import DataTable from '../../components/table/DataTable';
import type { DataTableColumn } from '../../components/table/tableTypes';
import { useAuth } from '../../contexts/AuthContext';
import api, { formatApiError } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { isArchivedAt } from '../../utils/softDelete';
import { memberHasEventsManageScope } from '../../utils/eventManagementAccess';
import { isBonspielCalendarType } from '../../utils/eventCalendarTypes';
import AdminEventDuplicateModal from './AdminEventDuplicateModal';

interface EventSummary {
  id: number;
  title: string;
  slug: string;
  visibility: string;
  published: number;
  calendarTypeIds?: string[];
  tournamentFormat?: 'fours' | 'doubles' | null;
  hasTournamentDraw?: boolean;
  capacity: number | null;
  feeMinor: number;
  memberFeeMinor?: number | null;
  currency: string;
  timespans: Array<{ start_dt: string; end_dt: string }>;
  archivedAt?: string | null;
  createdAt: string;
}

/** Local calendar YYYY-MM-DD (date only). */
function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dateKeyFromIso(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return localDateKey(date);
}

function eventStartEndDateKeys(event: EventSummary): { start: string | null; end: string | null } {
  const spans = event.timespans ?? [];
  let start: string | null = null;
  let end: string | null = null;
  for (const span of spans) {
    const spanStart = dateKeyFromIso(span.start_dt);
    const spanEnd = dateKeyFromIso(span.end_dt);
    if (spanStart && (start == null || spanStart < start)) start = spanStart;
    if (spanEnd && (end == null || spanEnd > end)) end = spanEnd;
  }
  return { start, end };
}

/** Sort key: start if upcoming, today if in progress; null if past (hidden). */
function eventListSortKey(event: EventSummary, todayKey: string): string | null {
  const { start, end } = eventStartEndDateKeys(event);
  if (start == null) return '9999-99-99';
  if (todayKey < start) return start;
  if (end == null || todayKey <= end) return todayKey;
  return null;
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatFee(feeMinor: number, currency: string): string {
  if (feeMinor <= 0) return 'Free';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'usd',
  }).format(feeMinor / 100);
}

function visibilityBadge(visibility: string) {
  const labels: Record<string, { text: string; className: string }> = {
    public: { text: 'Public', className: 'bg-green-100 text-green-800 dark:bg-emerald-900/30 dark:text-emerald-200' },
    active_members: { text: 'Members', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200' },
    ice_members: { text: 'Ice members', className: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-200' },
  };
  const badge = labels[visibility] || { text: visibility, className: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200' };
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${badge.className}`}>
      {badge.text}
    </span>
  );
}

export default function AdminEvents() {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [duplicateSourceEvent, setDuplicateSourceEvent] = useState<EventSummary | null>(null);
  const navigate = useNavigate();
  const { member } = useAuth();
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const isServerAdmin = Boolean(member?.isServerAdmin);
  const canManageAllEvents = memberHasEventsManageScope(member);

  const loadEvents = () => {
    setLoading(true);
    const params: Record<string, string> = { manageable: '1' };
    if (includeArchived) params.includeArchived = '1';
    api.get('/events', { params })
      .then((res) => setEvents(res.data || []))
      .catch((err) => showAlert(formatApiError(err, 'Failed to load events'), 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadEvents(); }, [includeArchived]);

  const visibleEvents = useMemo(() => {
    const todayKey = localDateKey(new Date());
    const rows = events.filter((event) => {
      const sortKey = eventListSortKey(event, todayKey);
      if (sortKey != null) return true;
      // Past by calendar end date: show when "Include archived items" is on
      // (same control also loads soft-archived rows from the API).
      return includeArchived;
    });
    rows.sort((a, b) => {
      const keyA = eventListSortKey(a, todayKey) ?? eventStartEndDateKeys(a).end ?? '0000-00-00';
      const keyB = eventListSortKey(b, todayKey) ?? eventStartEndDateKeys(b).end ?? '0000-00-00';
      if (keyA !== keyB) return keyA.localeCompare(keyB);
      const startA = eventStartEndDateKeys(a).start ?? '';
      const startB = eventStartEndDateKeys(b).start ?? '';
      if (startA !== startB) return startA.localeCompare(startB);
      return a.title.localeCompare(b.title);
    });
    return rows;
  }, [events, includeArchived]);

  const handleArchive = async (event: EventSummary) => {
    const confirmed = await confirm({
      message: `Archive "${event.title}"? The event will be hidden from public listings. Registrations and related data are preserved and can be restored later.`,
      title: 'Archive event',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      await api.delete(`/events/${event.id}`);
      showAlert('Event archived', 'success');
      loadEvents();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to archive event'), 'error');
    }
  };

  const handleRestore = async (event: EventSummary) => {
    const confirmed = await confirm({
      message: `Restore "${event.title}"? The event will appear in admin lists again. You can publish it when you are ready.`,
      title: 'Restore event',
      variant: 'info',
    });
    if (!confirmed) return;

    try {
      await api.post(`/events/${event.id}/restore`);
      showAlert('Event restored', 'success');
      loadEvents();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to restore event'), 'error');
    }
  };

  const handleDeletePermanently = async (event: EventSummary) => {
    const confirmed = await confirm({
      message: `Permanently delete "${event.title}"? This removes the event and all registrations. This cannot be undone.`,
      title: 'Delete event permanently',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      await api.delete(`/events/${event.id}/permanent`);
      showAlert('Event deleted permanently', 'success');
      loadEvents();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to delete event'), 'error');
    }
  };

  const handleTogglePublish = async (event: EventSummary) => {
    try {
      await api.patch(`/events/${event.id}`, { published: !event.published });
      showAlert(event.published ? 'Event unpublished' : 'Event published', 'success');
      loadEvents();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to update event'), 'error');
    }
  };

  const columns: Array<DataTableColumn<EventSummary>> = useMemo(
    () => [
      {
        id: 'event',
        header: 'Event',
        cellClassName: 'min-w-[14rem]',
        renderCell: (event) => (
          <Link
            to={`/admin/events/${event.id}`}
            className="font-medium text-primary-teal hover:underline"
          >
            {event.title}
          </Link>
        ),
      },
      {
        id: 'date',
        header: 'Date',
        cellClassName: 'text-sm text-gray-600 dark:text-gray-400',
        renderCell: (event) => (event.timespans?.[0] ? formatDate(event.timespans[0].start_dt) : 'TBD'),
      },
      {
        id: 'status',
        header: 'Status',
        align: 'center',
        renderCell: (event) => {
          if (isArchivedAt(event.archivedAt)) {
            return (
              <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                Archived
              </span>
            );
          }

          return (
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                event.published
                  ? 'bg-green-100 text-green-800 dark:bg-emerald-900/30 dark:text-emerald-200'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
              }`}
            >
              {event.published ? 'Published' : 'Draft'}
            </span>
          );
        },
      },
      {
        id: 'visibility',
        header: 'Visibility',
        align: 'center',
        renderCell: (event) => visibilityBadge(event.visibility),
      },
      {
        id: 'fee',
        header: 'Fee',
        align: 'right',
        cellClassName: 'text-sm text-gray-700 dark:text-gray-300',
        renderCell: (event) =>
          event.memberFeeMinor != null && event.memberFeeMinor !== event.feeMinor ? (
            <>
              {formatFee(event.feeMinor, event.currency)}
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                {formatFee(event.memberFeeMinor, event.currency)} member
              </span>
            </>
          ) : (
            formatFee(event.feeMinor, event.currency)
          ),
      },
      {
        id: 'capacity',
        header: 'Capacity',
        align: 'right',
        cellClassName: 'text-sm text-gray-700 dark:text-gray-300',
        renderCell: (event) => event.capacity ?? '∞',
      },
    ],
    []
  );

  return (
    <>
      <AppPage>
        <AppPageHeader
          title="Events"
          description={
            canManageAllEvents
              ? 'Manage club events and registrations.'
              : 'Manage events you own and their registrations.'
          }
          actions={
            canManageAllEvents ? (
              <Link to="/admin/events/new">
                <Button type="button" variant="primary">Create event</Button>
              </Link>
            ) : undefined
          }
        />

        {!loading && (
          <AppPageControlsRow
            right={(
              <IncludeArchivedToggle
                checked={includeArchived}
                onChange={setIncludeArchived}
              />
            )}
          />
        )}

        {loading && <AppStateCard title="Loading events..." />}

        {!loading && visibleEvents.length === 0 && (
          <AppStateCard
            title={
              includeArchived
                ? 'No events match these filters.'
                : canManageAllEvents
                  ? 'No upcoming or in-progress events.'
                  : 'You have no upcoming or in-progress events to manage.'
            }
            action={
              !includeArchived && canManageAllEvents ? (
                <Link to="/admin/events/new">
                  <Button type="button" variant="primary">Create event</Button>
                </Link>
              ) : undefined
            }
          />
        )}

        {!loading && visibleEvents.length > 0 && (
          <DataTable
            rows={visibleEvents}
            rowKey={(event) => event.id}
            columns={columns}
            actions={{
              widthClassName: 'w-[22rem]',
              renderActions: (event) => {
                const archived = isArchivedAt(event.archivedAt);
                const showScorekeeper =
                  !archived &&
                  isBonspielCalendarType(event.calendarTypeIds) &&
                  Boolean(event.hasTournamentDraw);

                return (
                  <div className="flex items-center justify-end gap-1">
                    {!archived ? (
                      <>
                        {showScorekeeper ? (
                          <Link
                            to={`/admin/events/${event.id}/scorekeeper`}
                            className="rounded px-2 py-1 text-xs font-medium text-primary-teal hover:bg-primary-teal/10"
                            title="Open scorekeeper"
                          >
                            Scorekeeper
                          </Link>
                        ) : null}
                        <button
                          onClick={() => handleTogglePublish(event)}
                          className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
                          title={event.published ? 'Unpublish' : 'Publish'}
                        >
                          {event.published ? 'Unpublish' : 'Publish'}
                        </button>
                        {canManageAllEvents ? (
                          <button
                            onClick={() => setDuplicateSourceEvent(event)}
                            className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
                            title="Duplicate"
                          >
                            Duplicate
                          </button>
                        ) : null}
                      </>
                    ) : null}
                    <SoftDeleteRowActions
                      archived={archived}
                      isServerAdmin={isServerAdmin}
                      onArchive={() => handleArchive(event)}
                      onRestore={() => handleRestore(event)}
                      onDeletePermanently={() => handleDeletePermanently(event)}
                    />
                  </div>
                );
              },
            }}
          />
        )}
      </AppPage>
      <AdminEventDuplicateModal
        sourceEvent={duplicateSourceEvent}
        onClose={() => setDuplicateSourceEvent(null)}
        onDuplicated={(eventId) => {
          setDuplicateSourceEvent(null);
          showAlert('Event duplicated', 'success');
          navigate(`/admin/events/${eventId}`);
        }}
      />
    </>
  );
}
