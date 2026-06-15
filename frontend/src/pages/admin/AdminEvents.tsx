import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppStateCard from '../../components/AppStateCard';
import Button from '../../components/Button';
import DataTable from '../../components/table/DataTable';
import type { DataTableColumn } from '../../components/table/tableTypes';
import api, { formatApiError } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';

interface EventSummary {
  id: number;
  title: string;
  slug: string;
  visibility: string;
  published: number;
  capacity: number | null;
  feeMinor: number;
  memberFeeMinor?: number | null;
  currency: string;
  timespans: Array<{ start_dt: string; end_dt: string }>;
  createdAt: string;
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
  const navigate = useNavigate();
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();

  const loadEvents = () => {
    setLoading(true);
    api.get('/events')
      .then((res) => setEvents(res.data || []))
      .catch((err) => showAlert(formatApiError(err, 'Failed to load events'), 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadEvents(); }, []);

  const handleDelete = async (event: EventSummary) => {
    const confirmed = await confirm({ message: `Delete "${event.title}"? This will remove all registrations.`, title: 'Delete event', variant: 'danger' });
    if (!confirmed) return;

    try {
      await api.delete(`/events/${event.id}`);
      showAlert('Event deleted', 'success');
      loadEvents();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to delete event'), 'error');
    }
  };

  const handleDuplicate = async (event: EventSummary) => {
    try {
      const res = await api.post(`/events/${event.id}/duplicate`);
      showAlert('Event duplicated', 'success');
      navigate(`/admin/events/${res.data.id}`);
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to duplicate event'), 'error');
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
        renderCell: (event) => (
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
              event.published
                ? 'bg-green-100 text-green-800 dark:bg-emerald-900/30 dark:text-emerald-200'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
            }`}
          >
            {event.published ? 'Published' : 'Draft'}
          </span>
        ),
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
          description="Manage club events and registrations."
          actions={
            <Link to="/admin/events/new">
              <Button type="button" variant="primary">Create event</Button>
            </Link>
          }
        />

        {loading && <AppStateCard title="Loading events..." />}

        {!loading && events.length === 0 && (
          <AppStateCard
            title="No events yet."
            action={
              <Link to="/admin/events/new">
                <Button type="button" variant="primary">Create event</Button>
              </Link>
            }
          />
        )}

        {!loading && events.length > 0 && (
          <DataTable
            rows={events}
            rowKey={(event) => event.id}
            columns={columns}
            actions={{
              widthClassName: 'w-[14rem]',
              renderActions: (event) => (
                <div className="flex items-center justify-end gap-1">
                  <button
                    onClick={() => handleTogglePublish(event)}
                    className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
                    title={event.published ? 'Unpublish' : 'Publish'}
                  >
                    {event.published ? 'Unpublish' : 'Publish'}
                  </button>
                  <button
                    onClick={() => handleDuplicate(event)}
                    className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
                    title="Duplicate"
                  >
                    Duplicate
                  </button>
                  <button
                    onClick={() => handleDelete(event)}
                    className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 hover:text-red-800 dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300"
                    title="Delete"
                  >
                    Delete
                  </button>
                </div>
              ),
            }}
          />
        )}
      </AppPage>
    </>
  );
}
