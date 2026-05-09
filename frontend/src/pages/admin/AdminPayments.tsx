import { useEffect, useMemo, useState } from 'react';
import api, { formatApiError } from '../../utils/api';
import Layout from '../../components/Layout';
import Button from '../../components/Button';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppStateCard from '../../components/AppStateCard';
import DataTable from '../../components/table/DataTable';
import type { DataTableColumn } from '../../components/table/tableTypes';
import { useAlert } from '../../contexts/AlertContext';
import { useAuth } from '../../contexts/AuthContext';
import { memberHasScope } from '../../utils/permissions';
import ChoiceInput, { type ChoiceOption } from '../../components/ChoiceInput';

type PaymentProvider = 'stripe' | 'paypal' | 'square';
type PaymentSubjectType = 'donation' | 'membership' | 'event_registration' | 'curling_registration';
type PaymentOrderStatus =
  | 'created'
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'refunded'
  | 'partially_refunded';
type PaymentEventStatus = 'received' | 'processed' | 'ignored' | 'failed';

type PaymentOrderSummary = {
  id: number;
  orderToken: string;
  provider: PaymentProvider;
  subjectType: PaymentSubjectType;
  subjectId: number | null;
  amountMinor: number;
  currency: string;
  status: PaymentOrderStatus;
  statusReason: string | null;
  providerOrderId: string | null;
  metadata: unknown;
  createdByMemberId: number | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type PaymentOrdersResponse = {
  total: number;
  limit: number;
  offset: number;
  orders: PaymentOrderSummary[];
};

type PaymentOrderDetailResponse = {
  order: Record<string, unknown>;
  transactions: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  refunds: Array<Record<string, unknown>>;
};

type PaymentEventSummary = {
  id: number;
  provider: PaymentProvider;
  providerEventId: string;
  eventType: string;
  paymentOrderId: number | null;
  processingStatus: PaymentEventStatus;
  processingError: string | null;
  rawPayload: unknown;
  receivedAt: string;
  processedAt: string | null;
};

type PaymentEventsResponse = {
  total: number;
  limit: number;
  offset: number;
  events: PaymentEventSummary[];
};

type PaymentResyncResponse = {
  reconciliation: {
    changed: boolean;
    previousStatus: PaymentOrderStatus;
    providerStatus: PaymentOrderStatus | null;
    currentStatus: PaymentOrderStatus;
    reason: string;
  };
  order: {
    id: number;
    status: PaymentOrderStatus;
    statusReason: string | null;
    updatedAt: string;
  } | null;
};

function formatMoney(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function formatDate(value: unknown): string {
  if (!value || typeof value !== 'string') return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function valueOfRecord(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

const PAYMENT_PROVIDER_OPTIONS: ChoiceOption<PaymentProvider>[] = [
  { value: 'stripe', label: 'Stripe' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'square', label: 'Square' },
];

const PAYMENT_SUBJECT_OPTIONS: ChoiceOption<PaymentSubjectType>[] = [
  { value: 'donation', label: 'Donation' },
  { value: 'membership', label: 'Membership' },
  { value: 'event_registration', label: 'Event registration' },
  { value: 'curling_registration', label: 'Curling registration' },
];

const PAYMENT_ORDER_STATUS_OPTIONS: ChoiceOption<PaymentOrderStatus>[] = [
  { value: 'created', label: 'Created' },
  { value: 'pending', label: 'Pending' },
  { value: 'succeeded', label: 'Succeeded' },
  { value: 'failed', label: 'Failed' },
  { value: 'partially_refunded', label: 'Partially refunded' },
  { value: 'refunded', label: 'Refunded' },
];

const PAYMENT_EVENT_STATUS_OPTIONS: ChoiceOption<PaymentEventStatus>[] = [
  { value: 'received', label: 'Received' },
  { value: 'processed', label: 'Processed' },
  { value: 'ignored', label: 'Ignored' },
  { value: 'failed', label: 'Failed' },
];

export default function AdminPayments() {
  const { member } = useAuth();
  const { showAlert } = useAlert();
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [loadingOrderDetail, setLoadingOrderDetail] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [resyncingOrder, setResyncingOrder] = useState(false);

  const [ordersData, setOrdersData] = useState<PaymentOrdersResponse | null>(null);
  const [orderDetail, setOrderDetail] = useState<PaymentOrderDetailResponse | null>(null);
  const [eventsData, setEventsData] = useState<PaymentEventsResponse | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);

  const [providerFilter, setProviderFilter] = useState<'' | PaymentProvider>('');
  const [subjectTypeFilter, setSubjectTypeFilter] = useState<'' | PaymentSubjectType>('');
  const [statusFilter, setStatusFilter] = useState<'' | PaymentOrderStatus>('');

  const [eventProviderFilter, setEventProviderFilter] = useState<'' | PaymentProvider>('');
  const [eventStatusFilter, setEventStatusFilter] = useState<'' | PaymentEventStatus>('');

  const loadOrders = async () => {
    setLoadingOrders(true);
    try {
      const params: Record<string, string | number> = { limit: 50, offset: 0 };
      if (providerFilter) params.provider = providerFilter;
      if (subjectTypeFilter) params.subjectType = subjectTypeFilter;
      if (statusFilter) params.status = statusFilter;
      const { data } = await api.get<PaymentOrdersResponse>('/payments/orders', { params });
      setOrdersData(data);
      if (data.orders.length === 0) {
        setSelectedOrderId(null);
        setOrderDetail(null);
        return;
      }
      const nextSelectedId =
        selectedOrderId && data.orders.some((order) => order.id === selectedOrderId)
          ? selectedOrderId
          : data.orders[0].id;
      setSelectedOrderId(nextSelectedId);
    } catch (error) {
      setOrdersData(null);
      showAlert(formatApiError(error, 'Failed to load payment orders'), 'error');
    } finally {
      setLoadingOrders(false);
    }
  };

  const loadOrderDetail = async (orderId: number) => {
    setLoadingOrderDetail(true);
    try {
      const { data } = await api.get<PaymentOrderDetailResponse>(`/payments/orders/${orderId}`);
      setOrderDetail(data);
    } catch (error) {
      setOrderDetail(null);
      showAlert(formatApiError(error, `Failed to load payment order ${orderId}`), 'error');
    } finally {
      setLoadingOrderDetail(false);
    }
  };

  const loadEvents = async () => {
    setLoadingEvents(true);
    try {
      const params: Record<string, string | number> = { limit: 50, offset: 0 };
      if (eventProviderFilter) params.provider = eventProviderFilter;
      if (eventStatusFilter) params.status = eventStatusFilter;
      const { data } = await api.get<PaymentEventsResponse>('/payments/events', { params });
      setEventsData(data);
    } catch (error) {
      setEventsData(null);
      showAlert(formatApiError(error, 'Failed to load payment events'), 'error');
    } finally {
      setLoadingEvents(false);
    }
  };

  useEffect(() => {
    void loadOrders();
  }, [providerFilter, subjectTypeFilter, statusFilter]);

  useEffect(() => {
    if (!selectedOrderId) {
      setOrderDetail(null);
      return;
    }
    void loadOrderDetail(selectedOrderId);
  }, [selectedOrderId]);

  useEffect(() => {
    void loadEvents();
  }, [eventProviderFilter, eventStatusFilter]);

  const selectedOrderSummary = useMemo(
    () => ordersData?.orders.find((order) => order.id === selectedOrderId) ?? null,
    [ordersData, selectedOrderId]
  );
  const canManagePayments = memberHasScope(member, 'payments.manage');

  const orderColumns: Array<DataTableColumn<PaymentOrderSummary>> = useMemo(
    () => [
      {
        id: 'order',
        header: 'Order',
        renderCell: (order) => (
          <button
            type="button"
            onClick={() => setSelectedOrderId(order.id)}
            className="text-left font-medium text-gray-900 hover:text-primary-teal dark:text-gray-100"
          >
            #{order.id}{' '}
            <span className="text-xs text-gray-500 dark:text-gray-400">({order.provider})</span>
          </button>
        ),
      },
      {
        id: 'subject',
        header: 'Subject',
        renderCell: (order) => (
          <>
            {order.subjectType}
            {order.subjectId ? `:${order.subjectId}` : ''}
          </>
        ),
      },
      {
        id: 'amount',
        header: 'Amount',
        renderCell: (order) => formatMoney(order.amountMinor, order.currency),
      },
      {
        id: 'status',
        header: 'Status',
        renderCell: (order) => order.status,
      },
      {
        id: 'created',
        header: 'Created',
        renderCell: (order) => formatDate(order.createdAt),
      },
    ],
    []
  );

  const resyncSelectedOrder = async () => {
    if (!selectedOrderId || !canManagePayments) return;
    setResyncingOrder(true);
    try {
      const { data } = await api.post<PaymentResyncResponse>(`/payments/orders/${selectedOrderId}/resync`);
      const reconciliation = data.reconciliation;
      if (reconciliation.changed) {
        showAlert(
          `Payment order #${selectedOrderId} updated from ${reconciliation.previousStatus} to ${reconciliation.currentStatus}.`,
          'success'
        );
      } else {
        showAlert(
          `Payment order #${selectedOrderId} remains ${reconciliation.currentStatus} (provider status: ${reconciliation.providerStatus ?? 'n/a'}).`,
          'info'
        );
      }
      await Promise.all([loadOrders(), loadEvents(), loadOrderDetail(selectedOrderId)]);
    } catch (error) {
      showAlert(formatApiError(error, `Failed to resync payment order #${selectedOrderId}`), 'error');
    } finally {
      setResyncingOrder(false);
    }
  };

  return (
    <Layout>
      <AppPage>
        <AppPageHeader
          title="Payment activity"
          description="Inspect payment orders, provider reconciliation details, and recent webhook processing events."
          actions={
            <Button
              variant="secondary"
              onClick={() => {
                void loadOrders();
                void loadEvents();
                if (selectedOrderId) void loadOrderDetail(selectedOrderId);
              }}
              disabled={loadingOrders || loadingEvents || loadingOrderDetail}
            >
              Refresh
            </Button>
          }
        />

        <div className="app-card">
          <h2 className="app-section-title">Payment orders</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <ChoiceInput<PaymentProvider>
              ariaLabel="Filter orders by provider"
              options={PAYMENT_PROVIDER_OPTIONS}
              value={providerFilter === '' ? null : providerFilter}
              onChange={(next) =>
                setProviderFilter(next == null || Array.isArray(next) ? '' : next)
              }
              placeholder="All providers"
              listboxLabel="Provider"
              inputClassName="app-input"
            />
            <ChoiceInput<PaymentSubjectType>
              ariaLabel="Filter orders by subject"
              options={PAYMENT_SUBJECT_OPTIONS}
              value={subjectTypeFilter === '' ? null : subjectTypeFilter}
              onChange={(next) =>
                setSubjectTypeFilter(next == null || Array.isArray(next) ? '' : next)
              }
              placeholder="All subjects"
              listboxLabel="Subject"
              inputClassName="app-input"
            />
            <ChoiceInput<PaymentOrderStatus>
              ariaLabel="Filter orders by status"
              options={PAYMENT_ORDER_STATUS_OPTIONS}
              value={statusFilter === '' ? null : statusFilter}
              onChange={(next) =>
                setStatusFilter(next == null || Array.isArray(next) ? '' : next)
              }
              placeholder="All statuses"
              listboxLabel="Order status"
              inputClassName="app-input"
            />
            <div className="flex items-center app-section-subtitle">
              Total: {ordersData?.total ?? 0}
            </div>
          </div>

          <DataTable
            className="mt-4"
            rows={ordersData?.orders ?? []}
            rowKey={(order) => order.id}
            columns={orderColumns}
            loading={loadingOrders}
            emptyState={<AppStateCard compact title="No payment orders found for current filters." />}
            getRowClassName={(order) => (order.id === selectedOrderId ? 'bg-teal-50 dark:bg-teal-900/20' : undefined)}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="app-card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="app-section-title">
                Order detail {selectedOrderSummary ? `#${selectedOrderSummary.id}` : ''}
              </h2>
              {canManagePayments && selectedOrderId && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    void resyncSelectedOrder();
                  }}
                  disabled={resyncingOrder || loadingOrderDetail}
                >
                  {resyncingOrder ? 'Resyncing...' : 'Resync with provider'}
                </Button>
              )}
            </div>

            {!selectedOrderId ? (
              <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Select an order to inspect details.</p>
            ) : loadingOrderDetail ? (
              <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Loading order detail...</p>
            ) : orderDetail ? (
              <div className="mt-3 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Order</h3>
                  <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-gray-950 p-3 text-xs text-gray-100">
                    {JSON.stringify(orderDetail.order, null, 2)}
                  </pre>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                    Transactions ({orderDetail.transactions.length})
                  </h3>
                  <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-gray-950 p-3 text-xs text-gray-100">
                    {JSON.stringify(orderDetail.transactions, null, 2)}
                  </pre>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                    Webhook events ({orderDetail.events.length})
                  </h3>
                  <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-gray-950 p-3 text-xs text-gray-100">
                    {JSON.stringify(orderDetail.events, null, 2)}
                  </pre>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                    Refunds ({orderDetail.refunds.length})
                  </h3>
                  <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-gray-950 p-3 text-xs text-gray-100">
                    {JSON.stringify(orderDetail.refunds, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Unable to load order detail.</p>
            )}
          </div>

          <div className="app-card">
            <h2 className="app-section-title">Recent webhook events</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <ChoiceInput<PaymentProvider>
                ariaLabel="Filter payment events by provider"
                options={PAYMENT_PROVIDER_OPTIONS}
                value={eventProviderFilter === '' ? null : eventProviderFilter}
                onChange={(next) =>
                  setEventProviderFilter(next == null || Array.isArray(next) ? '' : next)
                }
                placeholder="All providers"
                listboxLabel="Event provider"
                inputClassName="app-input"
              />
              <ChoiceInput<PaymentEventStatus>
                ariaLabel="Filter payment events by status"
                options={PAYMENT_EVENT_STATUS_OPTIONS}
                value={eventStatusFilter === '' ? null : eventStatusFilter}
                onChange={(next) =>
                  setEventStatusFilter(next == null || Array.isArray(next) ? '' : next)
                }
                placeholder="All statuses"
                listboxLabel="Event status"
                inputClassName="app-input"
              />
              <div className="flex items-center app-section-subtitle">
                Total: {eventsData?.total ?? 0}
              </div>
            </div>

            <div className="mt-4 max-h-[32rem] overflow-auto rounded-md border border-gray-200 dark:border-gray-700">
              {loadingEvents ? (
                <div className="p-3 text-sm text-gray-500 dark:text-gray-400">Loading events...</div>
              ) : eventsData && eventsData.events.length > 0 ? (
                <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                  {eventsData.events.map((event) => (
                    <li key={event.id} className="p-3">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-semibold text-gray-900 dark:text-gray-100">#{event.id}</span>
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                          {event.provider}
                        </span>
                        <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                          {event.processingStatus}
                        </span>
                        <span className="text-gray-600 dark:text-gray-400">{event.eventType}</span>
                      </div>
                      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        providerEventId: {event.providerEventId}
                      </div>
                      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        order: {event.paymentOrderId ?? '-'} • received: {formatDate(event.receivedAt)}
                      </div>
                      {event.processingError && (
                        <div className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">
                          {event.processingError}
                        </div>
                      )}
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-primary-teal">Show payload</summary>
                        <pre className="mt-2 max-h-64 overflow-auto rounded bg-gray-950 p-2 text-xs text-gray-100">
                          {JSON.stringify(event.rawPayload, null, 2)}
                        </pre>
                      </details>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="p-3 text-sm text-gray-500 dark:text-gray-400">
                  No webhook events found for current filters.
                </div>
              )}
            </div>
          </div>
        </div>

        {orderDetail && selectedOrderSummary && (
          <div className="app-card">
            <h2 className="app-section-title">Quick summary</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <div className="app-card-subtle">
                <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Order status</div>
                <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {String(valueOfRecord(orderDetail.order, 'status') ?? selectedOrderSummary.status)}
                </div>
              </div>
              <div className="app-card-subtle">
                <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Transactions</div>
                <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {orderDetail.transactions.length}
                </div>
              </div>
              <div className="app-card-subtle">
                <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Webhook events</div>
                <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {orderDetail.events.length}
                </div>
              </div>
              <div className="app-card-subtle">
                <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Refunds</div>
                <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {orderDetail.refunds.length}
                </div>
              </div>
            </div>
          </div>
        )}
      </AppPage>
    </Layout>
  );
}
