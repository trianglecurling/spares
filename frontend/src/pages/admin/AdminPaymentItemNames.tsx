import { useEffect, useMemo, useState } from 'react';
import api, { formatApiError } from '../../utils/api';
import Button from '../../components/Button';
import AppStateCard from '../../components/AppStateCard';
import DataTable from '../../components/table/DataTable';
import type { DataTableColumn } from '../../components/table/tableTypes';
import { useAlert } from '../../contexts/AlertContext';
import { useAuth } from '../../contexts/AuthContext';
import { memberHasScope } from '../../utils/permissions';

type EventPaymentItemNameRow = {
  id: number;
  title: string;
  slug: string;
  paymentItemName: string | null;
  timespans: Array<{ startDt: string; endDt: string }>;
  defaultItemName: string;
};

type EventPaymentItemNamesResponse = {
  events: EventPaymentItemNameRow[];
};

function formatDateRange(timespans: EventPaymentItemNameRow['timespans']): string {
  if (timespans.length === 0) return 'No dates';
  const starts = timespans.map((ts) => ts.startDt).sort();
  const ends = timespans.map((ts) => ts.endDt).sort();
  const start = new Date(starts[0]);
  const end = new Date(ends[ends.length - 1]);
  const dateOptions: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  const startLabel = start.toLocaleDateString('en-US', dateOptions);
  const endLabel = end.toLocaleDateString('en-US', dateOptions);
  return startLabel === endLabel ? startLabel : `${startLabel} – ${endLabel}`;
}

export default function AdminPaymentItemNames() {
  const { member } = useAuth();
  const { showAlert } = useAlert();
  const canManagePayments = memberHasScope(member, 'payments.manage');
  const [events, setEvents] = useState<EventPaymentItemNameRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draftNames, setDraftNames] = useState<Record<number, string>>({});
  const [savingEventId, setSavingEventId] = useState<number | null>(null);

  const loadEvents = async () => {
    setLoading(true);
    try {
      const { data } = await api.get<EventPaymentItemNamesResponse>('/payments/event-item-names');
      const rows = data.events ?? [];
      setEvents(rows);
      setDraftNames(
        Object.fromEntries(rows.map((event) => [event.id, event.paymentItemName ?? '']))
      );
    } catch (error) {
      setEvents([]);
      setDraftNames({});
      showAlert(formatApiError(error, 'Failed to load event item names'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadEvents();
  }, []);

  const saveItemName = async (event: EventPaymentItemNameRow) => {
    const nextValue = (draftNames[event.id] ?? '').trim();
    const normalized = nextValue.length > 0 ? nextValue : null;
    if (normalized === event.paymentItemName) return;

    setSavingEventId(event.id);
    try {
      await api.patch(`/payments/event-item-names/${event.id}`, {
        paymentItemName: normalized,
      });
      setEvents((current) =>
        current.map((row) =>
          row.id === event.id ? { ...row, paymentItemName: normalized } : row
        )
      );
      setDraftNames((current) => ({ ...current, [event.id]: normalized ?? '' }));
      showAlert(`Saved item name for "${event.title}".`, 'success');
    } catch (error) {
      showAlert(formatApiError(error, `Failed to save item name for "${event.title}"`), 'error');
    } finally {
      setSavingEventId(null);
    }
  };

  const columns: Array<DataTableColumn<EventPaymentItemNameRow>> = useMemo(
    () => [
      {
        id: 'event',
        header: 'Event',
        renderCell: (event) => (
          <div>
            <div className="font-medium text-gray-900 dark:text-gray-100">{event.title}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{formatDateRange(event.timespans)}</div>
          </div>
        ),
      },
      {
        id: 'itemName',
        header: 'Square item name',
        renderCell: (event) => {
          const draft = draftNames[event.id] ?? '';
          const isDirty = (draft.trim() || null) !== event.paymentItemName;
          return (
            <div className="space-y-2">
              <input
                type="text"
                className="app-input w-full max-w-md"
                value={draft}
                disabled={!canManagePayments || savingEventId === event.id}
                placeholder={event.defaultItemName}
                onChange={(e) =>
                  setDraftNames((current) => ({ ...current, [event.id]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canManagePayments && isDirty) {
                    e.preventDefault();
                    void saveItemName(event);
                  }
                }}
              />
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Default: {event.defaultItemName}
              </div>
              {canManagePayments && isDirty ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    void saveItemName(event);
                  }}
                  disabled={savingEventId === event.id}
                >
                  {savingEventId === event.id ? 'Saving…' : 'Save'}
                </Button>
              ) : null}
            </div>
          );
        },
      },
    ],
    [canManagePayments, draftNames, savingEventId]
  );

  return (
    <div className="app-card">
      <h2 className="app-section-title">Item names</h2>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        Set the line item name sent to Square when someone registers for an upcoming event. Leave blank
        to use the default label. Names should match QuickBooks items for your Square connector.
      </p>
      {!canManagePayments ? (
        <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">
          You can view item names but need the payments.manage scope to edit them.
        </p>
      ) : null}
      <DataTable
        className="mt-4"
        rows={events}
        rowKey={(event) => event.id}
        columns={columns}
        loading={loading}
        emptyState={
          <AppStateCard
            compact
            title="No upcoming events"
            description="Events with an end date on or after today will appear here."
          />
        }
      />
    </div>
  );
}
