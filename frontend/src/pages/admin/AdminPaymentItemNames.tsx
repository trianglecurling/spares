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

type RegistrationPaymentItemNameRow = {
  lineType: string;
  label: string;
  defaultItemName: string;
  paymentItemName: string | null;
};

type EventPaymentItemNamesResponse = {
  events: EventPaymentItemNameRow[];
};

type RegistrationPaymentItemNamesResponse = {
  items: RegistrationPaymentItemNameRow[];
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

function ItemNameEditor(props: {
  draft: string;
  savedValue: string | null;
  defaultItemName: string;
  canManage: boolean;
  saving: boolean;
  onDraftChange: (value: string) => void;
  onSave: () => void;
}) {
  const { draft, savedValue, defaultItemName, canManage, saving, onDraftChange, onSave } = props;
  const isDirty = (draft.trim() || null) !== savedValue;

  return (
    <div className="space-y-2">
      <input
        type="text"
        className="app-input w-full max-w-md"
        value={draft}
        disabled={!canManage || saving}
        placeholder={defaultItemName}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && canManage && isDirty) {
            e.preventDefault();
            onSave();
          }
        }}
      />
      <div className="text-xs text-gray-500 dark:text-gray-400">Default: {defaultItemName}</div>
      {canManage && isDirty ? (
        <Button variant="secondary" onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      ) : null}
    </div>
  );
}

export default function AdminPaymentItemNames() {
  const { member } = useAuth();
  const { showAlert } = useAlert();
  const canManagePayments = memberHasScope(member, 'payments.manage');
  const [events, setEvents] = useState<EventPaymentItemNameRow[]>([]);
  const [registrationItems, setRegistrationItems] = useState<RegistrationPaymentItemNameRow[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingRegistrationItems, setLoadingRegistrationItems] = useState(true);
  const [eventDraftNames, setEventDraftNames] = useState<Record<number, string>>({});
  const [registrationDraftNames, setRegistrationDraftNames] = useState<Record<string, string>>({});
  const [savingEventId, setSavingEventId] = useState<number | null>(null);
  const [savingRegistrationLineType, setSavingRegistrationLineType] = useState<string | null>(null);

  const loadEvents = async () => {
    setLoadingEvents(true);
    try {
      const { data } = await api.get<EventPaymentItemNamesResponse>('/payments/event-item-names');
      const rows = data.events ?? [];
      setEvents(rows);
      setEventDraftNames(
        Object.fromEntries(rows.map((event) => [event.id, event.paymentItemName ?? '']))
      );
    } catch (error) {
      setEvents([]);
      setEventDraftNames({});
      showAlert(formatApiError(error, 'Failed to load event item names'), 'error');
    } finally {
      setLoadingEvents(false);
    }
  };

  const loadRegistrationItems = async () => {
    setLoadingRegistrationItems(true);
    try {
      const { data } = await api.get<RegistrationPaymentItemNamesResponse>(
        '/payments/registration-item-names'
      );
      const rows = data.items ?? [];
      setRegistrationItems(rows);
      setRegistrationDraftNames(
        Object.fromEntries(rows.map((item) => [item.lineType, item.paymentItemName ?? '']))
      );
    } catch (error) {
      setRegistrationItems([]);
      setRegistrationDraftNames({});
      showAlert(formatApiError(error, 'Failed to load registration item names'), 'error');
    } finally {
      setLoadingRegistrationItems(false);
    }
  };

  useEffect(() => {
    void loadEvents();
    void loadRegistrationItems();
  }, []);

  const saveEventItemName = async (event: EventPaymentItemNameRow) => {
    const nextValue = (eventDraftNames[event.id] ?? '').trim();
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
      setEventDraftNames((current) => ({ ...current, [event.id]: normalized ?? '' }));
      showAlert(`Saved item name for "${event.title}".`, 'success');
    } catch (error) {
      showAlert(formatApiError(error, `Failed to save item name for "${event.title}"`), 'error');
    } finally {
      setSavingEventId(null);
    }
  };

  const saveRegistrationItemName = async (item: RegistrationPaymentItemNameRow) => {
    const nextValue = (registrationDraftNames[item.lineType] ?? '').trim();
    const normalized = nextValue.length > 0 ? nextValue : null;
    if (normalized === item.paymentItemName) return;

    setSavingRegistrationLineType(item.lineType);
    try {
      await api.patch(`/payments/registration-item-names/${item.lineType}`, {
        paymentItemName: normalized,
      });
      setRegistrationItems((current) =>
        current.map((row) =>
          row.lineType === item.lineType ? { ...row, paymentItemName: normalized } : row
        )
      );
      setRegistrationDraftNames((current) => ({ ...current, [item.lineType]: normalized ?? '' }));
      showAlert(`Saved item name for "${item.label}".`, 'success');
    } catch (error) {
      showAlert(formatApiError(error, `Failed to save item name for "${item.label}"`), 'error');
    } finally {
      setSavingRegistrationLineType(null);
    }
  };

  const registrationColumns: Array<DataTableColumn<RegistrationPaymentItemNameRow>> = useMemo(
    () => [
      {
        id: 'item',
        header: 'Registration item',
        renderCell: (item) => (
          <div className="font-medium text-gray-900 dark:text-gray-100">{item.label}</div>
        ),
      },
      {
        id: 'itemName',
        header: 'Square item name',
        renderCell: (item) => (
          <ItemNameEditor
            draft={registrationDraftNames[item.lineType] ?? ''}
            savedValue={item.paymentItemName}
            defaultItemName={item.defaultItemName}
            canManage={canManagePayments}
            saving={savingRegistrationLineType === item.lineType}
            onDraftChange={(value) =>
              setRegistrationDraftNames((current) => ({ ...current, [item.lineType]: value }))
            }
            onSave={() => {
              void saveRegistrationItemName(item);
            }}
          />
        ),
      },
    ],
    [canManagePayments, registrationDraftNames, savingRegistrationLineType]
  );

  const eventColumns: Array<DataTableColumn<EventPaymentItemNameRow>> = useMemo(
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
        renderCell: (event) => (
          <ItemNameEditor
            draft={eventDraftNames[event.id] ?? ''}
            savedValue={event.paymentItemName}
            defaultItemName={event.defaultItemName}
            canManage={canManagePayments}
            saving={savingEventId === event.id}
            onDraftChange={(value) =>
              setEventDraftNames((current) => ({ ...current, [event.id]: value }))
            }
            onSave={() => {
              void saveEventItemName(event);
            }}
          />
        ),
      },
    ],
    [canManagePayments, eventDraftNames, savingEventId]
  );

  return (
    <div className="space-y-6">
      <div className="app-card">
        <h2 className="app-section-title">Registration item names</h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Set the line item names sent to Square when someone pays during season registration. Leave
          blank to use the default label. Names should match QuickBooks items for your Square
          connector.
        </p>
        {!canManagePayments ? (
          <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">
            You can view item names but need the payments.manage scope to edit them.
          </p>
        ) : null}
        <DataTable
          className="mt-4"
          rows={registrationItems}
          rowKey={(item) => item.lineType}
          columns={registrationColumns}
          loading={loadingRegistrationItems}
          emptyState={
            <AppStateCard
              compact
              title="No registration items"
              description="Registration payment item types will appear here."
            />
          }
        />
      </div>

      <div className="app-card">
        <h2 className="app-section-title">Event item names</h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Set the line item name sent to Square when someone registers for an upcoming event. Leave
          blank to use the default label. Names should match QuickBooks items for your Square
          connector.
        </p>
        <DataTable
          className="mt-4"
          rows={events}
          rowKey={(event) => event.id}
          columns={eventColumns}
          loading={loadingEvents}
          emptyState={
            <AppStateCard
              compact
              title="No upcoming events"
              description="Events with an end date on or after today will appear here."
            />
          }
        />
      </div>
    </div>
  );
}
