import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import BackButton from '../../components/BackButton';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import api, { formatApiError } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { TeamPlayersField, defaultTeamPlayersJson } from '../../components/eventRegistration/TeamPlayersField';
import {
  isSubheadingFieldType,
  teamFieldOptionsFromRegistrationField,
  TEAM_POSITIONS_DOUBLES,
  TEAM_POSITIONS_FOUR,
} from '../../utils/eventRegistrationFieldPresets';
import { formatDisplayName, splitDisplayName } from '../../utils/personName';
import ChoiceInput, { type ChoiceOption } from '../../components/ChoiceInput';
import FormField from '../../components/FormField';

type EventRegistrationField = {
  id: number;
  label: string;
  field_type: string;
  scope: 'group' | 'individual';
  required: number;
  options: string | null;
  sort_order?: number;
};

type EventDetail = {
  id: number;
  title: string;
  feeMinor: number;
  allowGroupRegistration: number;
  registrationFields: EventRegistrationField[];
};

type RegistrationGroupMember = {
  id?: number;
  name: string;
  email: string | null;
  sort_order?: number;
};

type RegistrationFieldValue = {
  field_id: number;
  registration_member_id: number | null;
  value: string | null;
};

type RegistrationDetail = {
  id: number;
  contact_name: string;
  contact_email: string;
  status: string;
  group_size: number;
  waitlist_position: number | null;
  registered_at: string;
  payment_order_id: number | null;
  access_token?: string | null;
  groupMembers: RegistrationGroupMember[];
  fieldValues: RegistrationFieldValue[];
  payment?: {
    order_id: number;
    provider: 'stripe' | 'paypal' | 'square';
    status: string;
    amount_minor: number;
    currency: string;
    paid_minor: number | null;
    refunded_minor: number;
    provider_order_id: string | null;
    latest_transaction: {
      provider_transaction_id: string;
      transaction_type: 'charge' | 'capture' | 'refund' | 'adjustment';
      amount_minor: number;
      status: string;
      occurred_at: string | null;
    } | null;
    latest_refund: {
      status: string;
      amount_minor: number;
      provider_refund_id: string | null;
      processed_at: string | null;
      created_at: string;
    } | null;
  } | null;
};

type GroupMemberInput = { name: string; email: string };

function formatDateTime24(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month}/${day}/${year} ${hours}:${minutes}`;
}

function formatMinorCurrency(minor: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: (currency || 'usd').toUpperCase(),
  }).format(minor / 100);
}

function stripeDashboardUrl(
  stripeObjectId: string | null | undefined,
  fallbackCheckoutSessionId: string | null | undefined
): string | null {
  if (!stripeObjectId) return null;
  const isTestMode = (fallbackCheckoutSessionId || '').startsWith('cs_test_');
  const base = isTestMode ? 'https://dashboard.stripe.com/test' : 'https://dashboard.stripe.com';

  if (stripeObjectId.startsWith('pi_') || stripeObjectId.startsWith('ch_')) {
    return `${base}/payments/${encodeURIComponent(stripeObjectId)}`;
  }
  if (stripeObjectId.startsWith('re_')) {
    return `${base}/refunds/${encodeURIComponent(stripeObjectId)}`;
  }
  if (stripeObjectId.startsWith('cs_')) {
    return `${base}/checkout/sessions/${encodeURIComponent(stripeObjectId)}`;
  }
  return null;
}

function fieldOptions(field: EventRegistrationField): string[] {
  return (field.options ?? '')
    .split(',')
    .map((option) => option.trim())
    .filter(Boolean);
}

export default function AdminEventRegistrationEditor() {
  const { id, registrationId } = useParams<{ id: string; registrationId: string }>();
  const eventId = Number.parseInt(id || '', 10);
  const isNew = registrationId === 'new';
  const numericRegistrationId = Number.parseInt(registrationId || '', 10);
  const navigate = useNavigate();
  const { showAlert } = useAlert();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [managementLinkCopied, setManagementLinkCopied] = useState(false);

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [registration, setRegistration] = useState<RegistrationDetail | null>(null);
  const [contactFirstName, setContactFirstName] = useState('');
  const [contactLastName, setContactLastName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [groupMembers, setGroupMembers] = useState<GroupMemberInput[]>([]);
  const [fieldValueByKey, setFieldValueByKey] = useState<Record<string, string>>({});

  const eventAllowsGroupRegistration = event?.allowGroupRegistration === 1;
  const sortedFields = useMemo(
    () =>
      [...(event?.registrationFields ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [event?.registrationFields],
  );
  const groupFields = sortedFields.filter(
    (field) => field.scope === 'group' && !isSubheadingFieldType(field.field_type),
  );
  const individualFields = sortedFields.filter(
    (field) => field.scope === 'individual' && !isSubheadingFieldType(field.field_type),
  );

  const participants = useMemo(
    () => [
      { index: 0, label: formatDisplayName(contactFirstName, contactLastName) || 'Primary registrant' },
      ...groupMembers.map((member, idx) => ({
        index: idx + 1,
        label: member.name.trim() || `Group member ${idx + 1}`,
      })),
    ],
    [contactFirstName, contactLastName, groupMembers],
  );

  useEffect(() => {
    if (!Number.isFinite(eventId) || eventId <= 0 || (!isNew && (!Number.isFinite(numericRegistrationId) || numericRegistrationId <= 0))) {
      navigate('/admin/events', { replace: true });
      return;
    }

    let canceled = false;
    setLoading(true);
    Promise.all([
      api.get<EventDetail>(`/events/${eventId}`),
      isNew
        ? Promise.resolve<{ data: RegistrationDetail | null }>({ data: null })
        : api.get<RegistrationDetail>(`/events/${eventId}/registrations/${numericRegistrationId}`),
    ])
      .then(([eventRes, regRes]) => {
        if (canceled) return;
        setEvent(eventRes.data);
        const reg = regRes.data;
        setRegistration(reg);
        if (reg) {
          const { firstName, lastName } = splitDisplayName(reg.contact_name || '');
          setContactFirstName(firstName);
          setContactLastName(lastName);
          setContactEmail(reg.contact_email || '');
          const sortedMembers = [...(reg.groupMembers ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
          setGroupMembers(sortedMembers.map((member) => ({ name: member.name || '', email: member.email || '' })));

          const memberIndexById = new Map<number, number>();
          sortedMembers.forEach((member, idx) => {
            if (member.id != null) memberIndexById.set(member.id, idx + 1);
          });
          const nextFieldValues: Record<string, string> = {};
          for (const fieldValue of reg.fieldValues || []) {
            const index = fieldValue.registration_member_id == null
              ? 0
              : (memberIndexById.get(fieldValue.registration_member_id) ?? 0);
            nextFieldValues[`${fieldValue.field_id}:${index}`] = fieldValue.value ?? '';
          }
          setFieldValueByKey(nextFieldValues);
        } else {
          setContactFirstName('');
          setContactLastName('');
          setContactEmail('');
          setGroupMembers([]);
          setFieldValueByKey({});
        }
      })
      .catch((error) => {
        if (canceled) return;
        showAlert(formatApiError(error, 'Failed to load registration'), 'error');
        navigate(`/admin/events/${eventId}/registrations`, { replace: true });
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, [eventId, isNew, numericRegistrationId, navigate, showAlert]);

  const setFieldValue = (fieldId: number, participantIndex: number, value: string) => {
    setFieldValueByKey((prev) => ({ ...prev, [`${fieldId}:${participantIndex}`]: value }));
  };

  const addGroupMember = () => {
    setGroupMembers((prev) => [...prev, { name: '', email: '' }]);
  };

  const removeGroupMember = (index: number) => {
    setGroupMembers((prev) => prev.filter((_, idx) => idx !== index));
    setFieldValueByKey((prev) => {
      const next: Record<string, string> = {};
      Object.entries(prev).forEach(([key, value]) => {
        const [fieldIdRaw, participantRaw] = key.split(':');
        const participantIndex = Number.parseInt(participantRaw, 10);
        const fieldId = Number.parseInt(fieldIdRaw, 10);
        if (participantIndex === index + 1) return;
        if (participantIndex > index + 1) {
          next[`${fieldId}:${participantIndex - 1}`] = value;
          return;
        }
        next[key] = value;
      });
      return next;
    });
  };

  const updateGroupMember = (index: number, field: keyof GroupMemberInput, value: string) => {
    setGroupMembers((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!event) return;
    if (saving) return;

    setSaving(true);
    try {
      const normalizedGroupMembers = groupMembers
        .map((member) => ({
          name: member.name.trim(),
          email: member.email.trim(),
        }))
        .filter((member) => member.name.length > 0);

      const fieldValues: Array<{ fieldId: number; registrationMemberIndex?: number | null; value: string }> = [];
      groupFields.forEach((field) => {
        const value = (fieldValueByKey[`${field.id}:0`] || '').trim();
        if (!value) return;
        fieldValues.push({ fieldId: field.id, registrationMemberIndex: null, value });
      });
      individualFields.forEach((field) => {
        participants.forEach((participant) => {
          const value = (fieldValueByKey[`${field.id}:${participant.index}`] || '').trim();
          if (!value) return;
          fieldValues.push({
            fieldId: field.id,
            registrationMemberIndex: participant.index,
            value,
          });
        });
      });

      const payload = {
        contactFirstName: contactFirstName.trim(),
        contactLastName: contactLastName.trim(),
        contactEmail: contactEmail.trim(),
        groupMembers: normalizedGroupMembers.map((member) => ({
          name: member.name,
          email: member.email || null,
        })),
        fieldValues,
      };

      if (isNew) {
        const response = await api.post<{ registrationId: number }>(`/events/${eventId}/registrations`, payload);
        showAlert('Registration created', 'success');
        navigate(`/admin/events/${eventId}/registrations/${response.data.registrationId}`, { replace: true });
      } else {
        const response = await api.patch<RegistrationDetail>(`/events/${eventId}/registrations/${numericRegistrationId}`, payload);
        setRegistration(response.data);
        showAlert('Registration updated', 'success');
      }
    } catch (error) {
      showAlert(formatApiError(error, isNew ? 'Failed to create registration' : 'Failed to update registration'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelRegistration = async (refund: boolean) => {
    if (isNew || !registration || cancelBusy) return;
    setCancelBusy(true);
    try {
      const response = await api.post<{ success: boolean; refundIssued?: boolean; refundError?: string | null }>(
        `/events/${eventId}/registrations/${registration.id}/cancel`,
        { refund },
      );
      if (response.data?.refundError) {
        showAlert(`Registration canceled. Refund failed: ${response.data.refundError}`, 'warning');
      } else if (refund && response.data?.refundIssued) {
        showAlert('Registration canceled and refund initiated', 'success');
      } else {
        showAlert('Registration canceled', 'success');
      }
      navigate(`/admin/events/${eventId}/registrations`, { replace: true });
    } catch (error) {
      showAlert(formatApiError(error, 'Failed to cancel registration'), 'error');
    } finally {
      setCancelBusy(false);
      setShowCancelModal(false);
    }
  };

  const copyRegistrationManagementLink = async () => {
    if (!registration) return;

    try {
      const accessToken = registration.access_token?.trim();
      if (!accessToken) {
        showAlert('Registration management link is not available', 'error');
        return;
      }

      const url = `${window.location.origin}/events/registrations/manage/${encodeURIComponent(accessToken)}`;
      await navigator.clipboard.writeText(url);
      setManagementLinkCopied(true);
      setTimeout(() => setManagementLinkCopied(false), 2000);
    } catch {
      showAlert('Failed to copy to clipboard', 'error');
    }
  };

  if (loading) {
    return (
      <>
        <AppPage>
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading registration...</div>
        </AppPage>
      </>
    );
  }

  if (!event) {
    return (
      <>
        <AppPage>
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">Event not found.</div>
        </AppPage>
      </>
    );
  }

  const pageTitle = isNew
    ? `New registration: ${event.title}`
    : `Registration #${registration?.id ?? ''}: ${event.title}`;
  const showRefundWarning = event.feeMinor > 0 && registration?.status !== 'waitlisted';
  const payment = registration?.payment ?? null;
  const primaryTransactionId = payment?.latest_transaction?.provider_transaction_id ?? null;
  const checkoutSessionId = payment?.provider_order_id ?? null;
  const primaryStripeUrl = payment?.provider === 'stripe'
    ? stripeDashboardUrl(primaryTransactionId, checkoutSessionId)
    : null;
  const checkoutStripeUrl = payment?.provider === 'stripe'
    ? stripeDashboardUrl(checkoutSessionId, checkoutSessionId)
    : null;
  const refundStripeUrl = payment?.provider === 'stripe'
    ? stripeDashboardUrl(payment?.latest_refund?.provider_refund_id, checkoutSessionId)
    : null;

  return (
    <>
      <AppPage>
        <AppPageHeader
          title={pageTitle}
          description={isNew ? 'Create a manual registration. Payment is bypassed for admin-created records.' : 'View and edit full registration details.'}
          actions={
            <BackButton
              label="Registrations"
              onClick={() => navigate(`/admin/events/${event.id}/registrations`)}
            />
          }
        />

        {!isNew && registration && (
          <div className="app-card-subtle grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Status</p>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mt-0.5">
                {registration.status === 'cancelled' ? 'Canceled' : registration.status.replace(/_/g, ' ')}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Registered</p>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mt-0.5">{formatDateTime24(registration.registered_at)}</p>
            </div>
            {eventAllowsGroupRegistration && (
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Group size</p>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mt-0.5">{registration.group_size}</p>
              </div>
            )}
            {payment && (
              <div className="md:col-span-3 border-t border-gray-200 dark:border-gray-700 pt-3">
                <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Payment</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Amount paid</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mt-0.5">
                      {payment.paid_minor != null
                        ? formatMinorCurrency(payment.paid_minor, payment.currency)
                        : 'Not paid'}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Order total: {formatMinorCurrency(payment.amount_minor, payment.currency)}
                      {payment.refunded_minor > 0
                        ? ` | Refunded: ${formatMinorCurrency(payment.refunded_minor, payment.currency)}`
                        : ''}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Payment status</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mt-0.5">
                      {(payment.status || 'unknown').replace('_', ' ')}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Provider: {payment.provider}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Transaction ID</p>
                    {primaryTransactionId ? (
                      <p className="text-sm mt-0.5">
                        {primaryStripeUrl ? (
                          <a href={primaryStripeUrl} target="_blank" rel="noreferrer" className="text-primary-teal hover:underline break-all">
                            {primaryTransactionId}
                          </a>
                        ) : (
                          <span className="text-gray-900 dark:text-gray-100 break-all">{primaryTransactionId}</span>
                        )}
                      </p>
                    ) : (
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">-</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Checkout session</p>
                    {checkoutSessionId ? (
                      <p className="text-sm mt-0.5">
                        {checkoutStripeUrl ? (
                          <a href={checkoutStripeUrl} target="_blank" rel="noreferrer" className="text-primary-teal hover:underline break-all">
                            {checkoutSessionId}
                          </a>
                        ) : (
                          <span className="text-gray-900 dark:text-gray-100 break-all">{checkoutSessionId}</span>
                        )}
                      </p>
                    ) : (
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">-</p>
                    )}
                  </div>
                  {payment.latest_refund && (
                    <div className="md:col-span-2">
                      <p className="text-xs text-gray-500 dark:text-gray-400">Latest refund</p>
                      <p className="text-sm text-gray-900 dark:text-gray-100 mt-0.5">
                        {formatMinorCurrency(payment.latest_refund.amount_minor, payment.currency)} ({payment.latest_refund.status})
                        {payment.latest_refund.provider_refund_id
                          ? (
                            <>
                              {' - '}
                              {refundStripeUrl ? (
                                <a href={refundStripeUrl} target="_blank" rel="noreferrer" className="text-primary-teal hover:underline break-all">
                                  {payment.latest_refund.provider_refund_id}
                                </a>
                              ) : (
                                <span className="break-all">{payment.latest_refund.provider_refund_id}</span>
                              )}
                            </>
                          )
                          : ''}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {!isNew && registration ? (
          <p className="text-sm">
            <button
              type="button"
              onClick={() => void copyRegistrationManagementLink()}
              className={`hover:underline ${
                managementLinkCopied
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-primary-teal'
              }`}
            >
              {managementLinkCopied
                ? 'Registration management link copied'
                : 'Copy registration management link'}
            </button>
          </p>
        ) : null}

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-6">
          <form onSubmit={handleSave} className="space-y-6">
            <section className="space-y-4">
              <h2 className="app-section-title">Contact details</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField label="First name" htmlFor="admin-registration-first-name" required>
                  <input
                    id="admin-registration-first-name"
                    value={contactFirstName}
                    onChange={(e) => setContactFirstName(e.target.value)}
                    className="app-input"
                    autoComplete="given-name"
                    required
                  />
                </FormField>
                <FormField label="Last name" htmlFor="admin-registration-last-name" required>
                  <input
                    id="admin-registration-last-name"
                    value={contactLastName}
                    onChange={(e) => setContactLastName(e.target.value)}
                    className="app-input"
                    autoComplete="family-name"
                    required
                  />
                </FormField>
                <FormField label="Email" htmlFor="admin-registration-email" required>
                  <input
                    id="admin-registration-email"
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    className="app-input"
                    autoComplete="email"
                    required
                  />
                </FormField>
              </div>
            </section>

            {eventAllowsGroupRegistration && (
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="app-section-title">Group members</h2>
                  <Button type="button" variant="secondary" onClick={addGroupMember}>
                    Add member
                  </Button>
                </div>
                {groupMembers.length === 0 && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No additional members.</p>
                )}
                {groupMembers.map((member, idx) => (
                  <div key={idx} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                    <div>
                      <label className="app-label">Member name</label>
                      <input
                        value={member.name}
                        onChange={(e) => updateGroupMember(idx, 'name', e.target.value)}
                        className="app-input"
                        placeholder={`Group member ${idx + 1}`}
                      />
                    </div>
                    <div>
                      <label className="app-label">Member email</label>
                      <input
                        type="email"
                        value={member.email}
                        onChange={(e) => updateGroupMember(idx, 'email', e.target.value)}
                        className="app-input"
                        placeholder="Optional"
                      />
                    </div>
                    <Button type="button" variant="secondary" onClick={() => removeGroupMember(idx)} className="h-10">
                      Remove
                    </Button>
                  </div>
                ))}
              </section>
            )}

            {groupFields.length > 0 && (
              <section className="space-y-4">
                <div className="space-y-1">
                  <h2 className="app-section-title">Registration-level custom fields</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    These fields apply once to the whole registration, not per participant.
                  </p>
                </div>
                {groupFields.map((field) => (
                  <div key={field.id} className="space-y-1">
                    <label className="app-label">
                      {field.label}
                      {field.required === 1 ? ' *' : ''}
                    </label>
                    <FieldInput
                      field={field}
                      value={fieldValueByKey[`${field.id}:0`] ?? ''}
                      onChange={(value) => setFieldValue(field.id, 0, value)}
                      inputName={`field-${field.id}-0`}
                    />
                  </div>
                ))}
              </section>
            )}

            {individualFields.length > 0 && (
              <section className="space-y-4">
                <h2 className="app-section-title">Per-person fields</h2>
                <div className="space-y-4">
                  {individualFields.map((field) => (
                    <div key={field.id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">
                        {field.label}
                        {field.required === 1 ? ' *' : ''}
                      </p>
                      <div className="grid gap-3 md:grid-cols-2">
                        {participants.map((participant) => (
                          <div key={`${field.id}:${participant.index}`}>
                            <label className="app-label">{participant.label}</label>
                            <FieldInput
                              field={field}
                              value={fieldValueByKey[`${field.id}:${participant.index}`] ?? ''}
                              onChange={(value) => setFieldValue(field.id, participant.index, value)}
                              inputName={`field-${field.id}-${participant.index}`}
                              compact
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 dark:border-gray-700 pt-4">
              <div className="text-sm text-gray-500 dark:text-gray-400">
                {!isNew && registration
                  ? `Created ${formatDateTime24(registration.registered_at)}`
                  : 'This registration will skip checkout and fee collection.'}
              </div>
              <div className="flex items-center gap-2">
                {!isNew && registration && registration.status !== 'cancelled' && (
                  <Button type="button" variant="secondary" onClick={() => setShowCancelModal(true)}>
                    Cancel registration
                  </Button>
                )}
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving...' : isNew ? 'Create registration' : 'Save changes'}
                </Button>
              </div>
            </div>
          </form>
        </div>

        {!isNew && registration && (
          <Modal
            isOpen={showCancelModal}
            onClose={() => setShowCancelModal(false)}
            title="Cancel registration?"
            size="md"
          >
            <div className="space-y-4">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                This will cancel registration #{registration.id} for {registration.contact_name}.
              </p>
              {showRefundWarning && (
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  Canceling this registration will automatically refund the customer.
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setShowCancelModal(false)} disabled={cancelBusy}>
                  Keep registration
                </Button>
                {showRefundWarning && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => handleCancelRegistration(false)}
                    disabled={cancelBusy}
                  >
                    Cancel without refunding
                  </Button>
                )}
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => handleCancelRegistration(showRefundWarning)}
                  disabled={cancelBusy}
                >
                  {cancelBusy ? 'Canceling...' : showRefundWarning ? 'Cancel and refund customer' : 'Cancel registration'}
                </Button>
              </div>
            </div>
          </Modal>
        )}

        <div className="text-sm text-gray-500 dark:text-gray-400">
          <Link to={`/admin/events/${event.id}/registrations`} className="text-primary-teal hover:underline">
            Back to registrations
          </Link>
        </div>
      </AppPage>
    </>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  inputName,
  compact = false,
}: {
  field: EventRegistrationField;
  value: string;
  onChange: (value: string) => void;
  inputName?: string;
  compact?: boolean;
}) {
  const options = fieldOptions(field);
  const className = compact ? 'app-input py-1.5 text-sm' : 'app-input';
  if (field.field_type === 'checkbox') {
    return (
      <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <input
          type="checkbox"
          checked={value === '1' || value === 'true'}
          onChange={(e) => onChange(e.target.checked ? '1' : '0')}
          aria-label={field.label}
        />
        <span>Checked</span>
      </label>
    );
  }
  if (field.field_type === 'dropdown') {
    const dropdownOptions: ChoiceOption<string>[] = options.map((option) => ({
      value: option,
      label: option,
    }));
    return (
      <ChoiceInput<string>
        options={dropdownOptions}
        value={value || null}
        onChange={(next) => onChange(next == null || Array.isArray(next) ? '' : next)}
        placeholder="Select..."
        listboxLabel={field.label}
        required={field.required === 1}
        inputClassName={className}
        ariaLabel={field.label}
      />
    );
  }
  if (field.field_type === 'preset_phone') {
    return (
      <input
        type="tel"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={className}
        required={field.required === 1}
      />
    );
  }
  if (field.field_type === 'preset_team_name') {
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={className}
        required={field.required === 1}
        placeholder="Team name"
      />
    );
  }
  if (field.field_type === 'preset_dob') {
    return (
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={className}
        required={field.required === 1}
      />
    );
  }
  if (field.field_type === 'preset_team_four') {
    return (
      <TeamPlayersField
        label={field.label}
        required={field.required === 1}
        value={value || defaultTeamPlayersJson(4)}
        onChange={onChange}
        positions={TEAM_POSITIONS_FOUR}
        inputClassName={className}
        showLegend={false}
        collectDietaryRestrictions={
          teamFieldOptionsFromRegistrationField(field).collectDietaryRestrictions
        }
      />
    );
  }
  if (field.field_type === 'preset_team_doubles') {
    return (
      <TeamPlayersField
        label={field.label}
        required={field.required === 1}
        value={value || defaultTeamPlayersJson(2)}
        onChange={onChange}
        positions={TEAM_POSITIONS_DOUBLES}
        inputClassName={className}
        showLegend={false}
        collectDietaryRestrictions={
          teamFieldOptionsFromRegistrationField(field).collectDietaryRestrictions
        }
      />
    );
  }
  if (field.field_type === 'preset_address') {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={className}
        rows={4}
        required={field.required === 1}
        spellCheck={false}
      />
    );
  }
  if (field.field_type === 'radio') {
    return (
      <div className="space-y-2">
        {!field.required && (
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="radio"
              name={inputName ?? `field-${field.id}-${compact ? 'compact' : 'full'}`}
              checked={value === ''}
              onChange={() => onChange('')}
            />
            <span>None</span>
          </label>
        )}
        {options.map((option) => (
          <label key={option} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="radio"
              name={inputName ?? `field-${field.id}-${compact ? 'compact' : 'full'}`}
              checked={value === option}
              onChange={() => onChange(option)}
              required={field.required === 1 && !value}
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
    );
  }
  return (
    <input
      type={field.field_type === 'number' ? 'number' : 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
      required={field.required === 1}
    />
  );
}
