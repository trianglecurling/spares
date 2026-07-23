import { FormEvent, useEffect, useId, useMemo, useState } from 'react';
import api, { formatApiError } from '../../utils/api';
import Button from '../../components/Button';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppStateCard from '../../components/AppStateCard';
import DataTable from '../../components/table/DataTable';
import type { DataTableColumn } from '../../components/table/tableTypes';
import FormField from '../../components/FormField';
import FormSection from '../../components/FormSection';
import FormCheckbox from '../../components/FormCheckbox';
import ChoiceInput, { type ChoiceOption } from '../../components/ChoiceInput';
import InlineStateMessage from '../../components/InlineStateMessage';
import Modal from '../../components/Modal';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';

type WebhookEventRegistryEntry = {
  eventType: string;
  label: string;
  description: string;
};

type WebhookSummary = {
  id: number;
  eventType: string;
  eventLabel: string;
  destinationUrl: string;
  secret?: string;
  enabled: boolean;
  description: string | null;
  createdByMemberId: number | null;
  createdAt: string;
  updatedAt: string;
};

type WebhooksListResponse = {
  webhooks: WebhookSummary[];
};

type WebhookEventsResponse = {
  events: WebhookEventRegistryEntry[];
};

type WebhookCreateResponse = {
  webhook: WebhookSummary;
};

type WebhookDeliverySummary = {
  id: number;
  webhookId: number;
  eventType: string;
  eventLabel: string;
  payload: unknown;
  requestUrl: string;
  responseStatus: number | null;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
};

type WebhookDeliveriesResponse = {
  total: number;
  limit: number;
  offset: number;
  deliveries: WebhookDeliverySummary[];
};

type WebhookTestResponse = {
  test: {
    success: boolean;
    responseStatus: number | null;
    errorMessage: string | null;
  };
};

function formatDate(value: unknown): string {
  if (!value || typeof value !== 'string') return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatPayload(payload: unknown): string {
  if (payload == null) return '';
  if (typeof payload === 'string') {
    try {
      return JSON.stringify(JSON.parse(payload), null, 2);
    } catch {
      return payload;
    }
  }
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

export default function AdminWebhooks() {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const eventFieldId = useId();
  const destinationUrlFieldId = useId();
  const descriptionFieldId = useId();

  const [loading, setLoading] = useState(true);
  const [loadingDeliveries, setLoadingDeliveries] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [payloadModalDelivery, setPayloadModalDelivery] = useState<WebhookDeliverySummary | null>(null);

  const [eventRegistry, setEventRegistry] = useState<WebhookEventRegistryEntry[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookSummary[]>([]);
  const [selectedWebhookId, setSelectedWebhookId] = useState<number | null>(null);
  const [deliveriesData, setDeliveriesData] = useState<WebhookDeliveriesResponse | null>(null);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  const [eventType, setEventType] = useState('');
  const [destinationUrl, setDestinationUrl] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(true);

  const eventOptions = useMemo<ChoiceOption<string>[]>(
    () => eventRegistry.map((entry) => ({ value: entry.eventType, label: entry.label })),
    [eventRegistry]
  );

  const selectedWebhook = useMemo(
    () => webhooks.find((webhook) => webhook.id === selectedWebhookId) ?? null,
    [webhooks, selectedWebhookId]
  );

  const resetCreateForm = () => {
    setDestinationUrl('');
    setDescription('');
    setEnabled(true);
    setCreatedSecret(null);
    if (eventRegistry.length > 0) {
      setEventType(eventRegistry[0].eventType);
    } else {
      setEventType('');
    }
  };

  const openCreateModal = () => {
    resetCreateForm();
    setCreateModalOpen(true);
  };

  const closeCreateModal = () => {
    if (saving) return;
    setCreateModalOpen(false);
    resetCreateForm();
  };

  const loadWebhooks = async () => {
    setLoading(true);
    try {
      const [eventsRes, webhooksRes] = await Promise.all([
        api.get<WebhookEventsResponse>('/webhooks/events'),
        api.get<WebhooksListResponse>('/webhooks'),
      ]);
      setEventRegistry(eventsRes.data.events);
      setWebhooks(webhooksRes.data.webhooks);
      if (webhooksRes.data.webhooks.length === 0) {
        setSelectedWebhookId(null);
        setDeliveriesData(null);
      } else {
        const nextSelectedId =
          selectedWebhookId && webhooksRes.data.webhooks.some((webhook) => webhook.id === selectedWebhookId)
            ? selectedWebhookId
            : webhooksRes.data.webhooks[0].id;
        setSelectedWebhookId(nextSelectedId);
      }
      if (!eventType && eventsRes.data.events.length > 0) {
        setEventType(eventsRes.data.events[0].eventType);
      }
    } catch (error) {
      setWebhooks([]);
      setEventRegistry([]);
      showAlert(formatApiError(error, 'Failed to load webhooks'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadDeliveries = async (webhookId: number) => {
    setLoadingDeliveries(true);
    try {
      const { data } = await api.get<WebhookDeliveriesResponse>(`/webhooks/${webhookId}/deliveries`, {
        params: { limit: 50, offset: 0 },
      });
      setDeliveriesData(data);
    } catch (error) {
      setDeliveriesData(null);
      showAlert(formatApiError(error, 'Failed to load webhook deliveries'), 'error');
    } finally {
      setLoadingDeliveries(false);
    }
  };

  useEffect(() => {
    void loadWebhooks();
  }, []);

  useEffect(() => {
    if (selectedWebhookId == null) return;
    void loadDeliveries(selectedWebhookId);
  }, [selectedWebhookId]);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!eventType || !destinationUrl.trim()) {
      showAlert('Event and destination URL are required.', 'error');
      return;
    }

    setSaving(true);
    try {
      const { data } = await api.post<WebhookCreateResponse>('/webhooks', {
        eventType,
        destinationUrl: destinationUrl.trim(),
        description: description.trim() || null,
        enabled,
      });
      setCreatedSecret(data.webhook.secret ?? null);
      showAlert('Webhook created.', 'success');
      await loadWebhooks();
      setSelectedWebhookId(data.webhook.id);
    } catch (error) {
      showAlert(formatApiError(error, 'Failed to create webhook'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (webhook: WebhookSummary) => {
    try {
      await api.patch(`/webhooks/${webhook.id}`, { enabled: !webhook.enabled });
      showAlert(webhook.enabled ? 'Webhook disabled.' : 'Webhook enabled.', 'success');
      await loadWebhooks();
    } catch (error) {
      showAlert(formatApiError(error, 'Failed to update webhook'), 'error');
    }
  };

  const handleDelete = async (webhook: WebhookSummary) => {
    const confirmed = await confirm({
      title: 'Delete webhook',
      message: `Delete the webhook for "${webhook.eventLabel}"? This cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;

    setDeleting(true);
    try {
      await api.delete(`/webhooks/${webhook.id}`);
      showAlert('Webhook deleted.', 'success');
      if (selectedWebhookId === webhook.id) {
        setSelectedWebhookId(null);
        setDeliveriesData(null);
      }
      await loadWebhooks();
    } catch (error) {
      showAlert(formatApiError(error, 'Failed to delete webhook'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleTest = async (webhook: WebhookSummary) => {
    setTesting(true);
    try {
      const { data } = await api.post<WebhookTestResponse>(`/webhooks/${webhook.id}/test`);
      if (data.test.success) {
        showAlert('Test webhook delivered successfully.', 'success');
      } else {
        showAlert(
          data.test.errorMessage ?? `Test webhook failed with HTTP ${data.test.responseStatus ?? 'error'}.`,
          'error'
        );
      }
      await loadDeliveries(webhook.id);
    } catch (error) {
      showAlert(formatApiError(error, 'Failed to send test webhook'), 'error');
    } finally {
      setTesting(false);
    }
  };

  const handleCopySecret = async (secret: string) => {
    try {
      await navigator.clipboard.writeText(secret);
      showAlert('Secret copied to clipboard.', 'success');
    } catch {
      showAlert('Could not copy secret to clipboard.', 'error');
    }
  };

  const webhookColumns = useMemo<DataTableColumn<WebhookSummary>[]>(
    () => [
      {
        id: 'event',
        header: 'Event',
        renderCell: (row) => (
          <button
            type="button"
            onClick={() => setSelectedWebhookId(row.id)}
            className="text-left font-medium text-gray-900 hover:text-primary-teal-link dark:text-gray-100"
          >
            {row.eventLabel}
          </button>
        ),
      },
      {
        id: 'destination',
        header: 'Destination URL',
        renderCell: (row) => (
          <span className="break-all font-mono text-sm text-gray-700 dark:text-gray-300">{row.destinationUrl}</span>
        ),
      },
      {
        id: 'enabled',
        header: 'Enabled',
        renderCell: (row) => (row.enabled ? 'Yes' : 'No'),
      },
      {
        id: 'updated',
        header: 'Updated',
        renderCell: (row) => formatDate(row.updatedAt),
      },
    ],
    []
  );

  const deliveryColumns = useMemo<DataTableColumn<WebhookDeliverySummary>[]>(
    () => [
      {
        id: 'created',
        header: 'Sent at',
        renderCell: (row) => formatDate(row.createdAt),
      },
      {
        id: 'status',
        header: 'Status',
        renderCell: (row) =>
          row.success
            ? `Success (${row.responseStatus ?? 'OK'})`
            : row.errorMessage ?? `Failed (${row.responseStatus ?? 'error'})`,
      },
      {
        id: 'payload',
        header: 'Payload',
        renderCell: (row) => (
          <Button type="button" variant="secondary" onClick={() => setPayloadModalDelivery(row)}>
            Show payload
          </Button>
        ),
      },
    ],
    []
  );

  const selectedEventDescription =
    eventRegistry.find((entry) => entry.eventType === eventType)?.description ?? null;

  return (
    <>
      <AppPage>
        <AppPageHeader
          title="Outbound webhooks"
          description="Send JSON notifications to external HTTPS endpoints when club events occur."
          actions={
            <Button type="button" onClick={openCreateModal}>
              Create webhook
            </Button>
          }
        />

        {loading ? (
          <AppStateCard title="Loading webhooks" description="Fetching webhook configuration..." />
        ) : (
          <div className="space-y-6">
            <section className="app-card">
              <h2 className="app-section-title">Configured webhooks</h2>
              {webhooks.length === 0 ? (
                <div className="mt-4">
                  <InlineStateMessage
                    title="No webhooks configured yet."
                    action={
                      <Button type="button" onClick={openCreateModal}>
                        Create webhook
                      </Button>
                    }
                  />
                </div>
              ) : (
                <DataTable
                  className="mt-4"
                  rows={webhooks}
                  rowKey={(row) => row.id}
                  columns={webhookColumns}
                  getRowClassName={(row) =>
                    row.id === selectedWebhookId ? 'bg-teal-50 dark:bg-teal-900/20' : undefined
                  }
                />
              )}
            </section>

            {selectedWebhook ? (
              <section className="app-card">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="app-section-title">{selectedWebhook.eventLabel}</h2>
                    <p className="break-all font-mono text-sm text-gray-700 dark:text-gray-300">{selectedWebhook.destinationUrl}</p>
                    {selectedWebhook.description ? (
                      <p className="app-section-subtitle mt-2">{selectedWebhook.description}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void handleToggleEnabled(selectedWebhook)}
                    >
                      {selectedWebhook.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={testing}
                      onClick={() => void handleTest(selectedWebhook)}
                    >
                      {testing ? 'Sending test...' : 'Send test'}
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      disabled={deleting}
                      onClick={() => void handleDelete(selectedWebhook)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>

                <div className="mt-6 border-t border-gray-200 pt-6 dark:border-gray-700">
                  <h2 className="app-section-title">Delivery log</h2>
                  {loadingDeliveries ? (
                    <div className="mt-4">
                      <InlineStateMessage title="Loading deliveries..." />
                    </div>
                  ) : deliveriesData && deliveriesData.deliveries.length > 0 ? (
                    <DataTable
                      className="mt-4"
                      rows={deliveriesData.deliveries}
                      rowKey={(row) => row.id}
                      columns={deliveryColumns}
                    />
                  ) : (
                    <div className="mt-4">
                      <InlineStateMessage title="No deliveries recorded yet." />
                    </div>
                  )}
                </div>
              </section>
            ) : null}
          </div>
        )}
      </AppPage>

      <Modal
        isOpen={createModalOpen}
        onClose={closeCreateModal}
        title={createdSecret ? 'Webhook created' : 'Create webhook'}
        size="lg"
        verticalAlign="start"
      >
        {createdSecret ? (
          <div className="space-y-4">
            <div className="app-alert border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
              <p className="text-sm font-medium">Webhook secret (shown once)</p>
              <p className="mt-1 text-sm opacity-90">
                Copy this secret before closing. Receivers can verify the{' '}
                <code className="font-mono">X-Broomstack-Signature</code> header using it.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <code className="break-all rounded border border-amber-200 bg-white px-2 py-1 font-mono text-sm text-gray-900 dark:border-amber-700/60 dark:bg-gray-950 dark:text-amber-100">
                  {createdSecret}
                </code>
                <Button type="button" variant="secondary" onClick={() => void handleCopySecret(createdSecret)}>
                  Copy secret
                </Button>
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="button" onClick={closeCreateModal}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleCreate} className="space-y-4">
            <p className="app-section-subtitle">
              Choose an event and destination URL. A signing secret is generated automatically so receivers can verify requests from Broomstack.
            </p>
            <FormSection title="Webhook settings">
              <FormField label="Event" htmlFor={eventFieldId} required>
                <ChoiceInput
                  inputId={eventFieldId}
                  ariaLabel="Webhook event"
                  value={eventType || null}
                  onChange={(next) => setEventType(next == null || Array.isArray(next) ? '' : next)}
                  options={eventOptions}
                  placeholder="Select an event"
                  listboxLabel="Event"
                />
              </FormField>
              {selectedEventDescription ? (
                <p className="app-section-subtitle">{selectedEventDescription}</p>
              ) : null}
              <FormField label="Destination URL" htmlFor={destinationUrlFieldId} required>
                <input
                  id={destinationUrlFieldId}
                  type="url"
                  className="app-input"
                  value={destinationUrl}
                  onChange={(e) => setDestinationUrl(e.target.value)}
                  placeholder="https://hooks.zapier.com/hooks/catch/..."
                  required
                />
              </FormField>
              <FormField label="Description" htmlFor={descriptionFieldId}>
                <input
                  id={descriptionFieldId}
                  type="text"
                  className="app-input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional note for admins"
                />
              </FormField>
              <FormCheckbox label="Enabled" checked={enabled} onChange={setEnabled} />
            </FormSection>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={saving}>
                {saving ? 'Creating...' : 'Create webhook'}
              </Button>
              <Button type="button" variant="secondary" onClick={closeCreateModal} disabled={saving}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        isOpen={payloadModalDelivery != null}
        onClose={() => setPayloadModalDelivery(null)}
        title="Delivery payload"
        size="lg"
        verticalAlign="start"
      >
        {payloadModalDelivery ? (
          <div className="space-y-4">
            <p className="app-section-subtitle">
              Sent {formatDate(payloadModalDelivery.createdAt)}
              {payloadModalDelivery.success
                ? ` · Success (${payloadModalDelivery.responseStatus ?? 'OK'})`
                : ` · ${payloadModalDelivery.errorMessage ?? `Failed (${payloadModalDelivery.responseStatus ?? 'error'})`}`}
            </p>
            <pre className="max-h-[min(60vh,32rem)] overflow-auto rounded-md bg-gray-950 p-4 text-xs text-gray-100">
              {formatPayload(payloadModalDelivery.payload)}
            </pre>
            <div className="flex justify-end">
              <Button type="button" variant="secondary" onClick={() => setPayloadModalDelivery(null)}>
                Close
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
