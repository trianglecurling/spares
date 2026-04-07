import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Layout from '../../components/Layout';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import Button from '../../components/Button';
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

  return (
    <Layout>
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

        {loading && <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading...</div>}

        {!loading && events.length === 0 && (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            <p>No events yet.</p>
          </div>
        )}

        {!loading && events.length > 0 && (
          <div className="app-table-shell overflow-x-auto">
            <table className="app-table w-full">
              <thead className="app-table-head">
                <tr>
                  <th className="app-table-th text-left">Event</th>
                  <th className="app-table-th text-left">Date</th>
                  <th className="app-table-th text-center">Status</th>
                  <th className="app-table-th text-center">Visibility</th>
                  <th className="app-table-th text-right">Fee</th>
                  <th className="app-table-th text-right">Capacity</th>
                  <th className="app-table-th text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-800">
                {events.map((event) => (
                  <tr key={event.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="app-table-td">
                      <Link
                        to={`/admin/events/${event.id}`}
                        className="text-primary-teal hover:underline font-medium"
                      >
                        {event.title}
                      </Link>
                    </td>
                    <td className="app-table-td text-sm text-gray-600 dark:text-gray-400">
                      {event.timespans?.[0]
                        ? formatDate(event.timespans[0].start_dt)
                        : 'TBD'}
                    </td>
                    <td className="app-table-td text-center">
                      <span
                        className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${
                          event.published
                            ? 'bg-green-100 text-green-800 dark:bg-emerald-900/30 dark:text-emerald-200'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {event.published ? 'Published' : 'Draft'}
                      </span>
                    </td>
                    <td className="app-table-td text-center">{visibilityBadge(event.visibility)}</td>
                    <td className="app-table-td text-right text-sm text-gray-700 dark:text-gray-300">
                      {event.memberFeeMinor != null && event.memberFeeMinor !== event.feeMinor ? (
                        <>
                          {formatFee(event.feeMinor, event.currency)}
                          <span className="block text-xs text-gray-500 dark:text-gray-400">
                            {formatFee(event.memberFeeMinor, event.currency)} member
                          </span>
                        </>
                      ) : (
                        formatFee(event.feeMinor, event.currency)
                      )}
                    </td>
                    <td className="app-table-td text-right text-sm text-gray-700 dark:text-gray-300">{event.capacity ?? '∞'}</td>
                    <td className="app-table-td text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleTogglePublish(event)}
                          className="px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                          title={event.published ? 'Unpublish' : 'Publish'}
                        >
                          {event.published ? 'Unpublish' : 'Publish'}
                        </button>
                        <button
                          onClick={() => handleDuplicate(event)}
                          className="px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                          title="Duplicate"
                        >
                          Duplicate
                        </button>
                        <button
                          onClick={() => handleDelete(event)}
                          className="px-2 py-1 text-xs text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                          title="Delete"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AppPage>
    </Layout>
  );
}
