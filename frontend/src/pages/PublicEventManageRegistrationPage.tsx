import { FormEvent, useEffect, useId, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import FormField from '../components/FormField';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import SeoMeta from '../components/SeoMeta';
import PublicRegistrationFieldInput, {
  publicEventRegistrationInput,
  fieldValueKey,
  personLabel,
  type EventRegistrationField,
} from '../components/eventRegistration/PublicRegistrationFieldInput';
import { isSubheadingFieldType } from '../utils/eventRegistrationFieldPresets';
import api, { formatApiError } from '../utils/api';
import { useAlert } from '../contexts/AlertContext';
import { useConfirm } from '../contexts/ConfirmContext';

const publicInput = publicEventRegistrationInput;

interface GroupMember {
  name: string;
  email: string;
}

interface ManageRegistrationPayload {
  event: {
    id: number;
    title: string;
    slug: string;
    allowGroupRegistration: number;
    maxGroupSize: number | null;
    registrationFields: EventRegistrationField[];
    cancellationCutoff: string | null;
    pointOfContact: string;
  };
  registration: {
    id: number;
    status: string;
    contactFirstName: string;
    contactLastName: string;
    contactEmail: string;
    groupMembers: GroupMember[];
    fieldValues: Array<{ fieldId: number; registrationMemberIndex: number | null; value: string }>;
    waitlistPosition: number | null;
  };
  receiptUrl: string | null;
  canCancel: boolean;
  cancellationCutoffPassed: boolean;
  serverNow: string;
}

function formatStatusLabel(status: string): string {
  switch (status) {
    case 'confirmed':
      return 'Confirmed';
    case 'waitlisted':
      return 'Waitlisted';
    case 'pending_payment':
      return 'Pending payment';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status.replace(/_/g, ' ');
  }
}

function applyPayloadToForm(payload: ManageRegistrationPayload) {
  const nextFieldValues: Record<string, string> = {};
  for (const fieldValue of payload.registration.fieldValues) {
    const personIndex = fieldValue.registrationMemberIndex ?? 0;
    const field = payload.event.registrationFields.find((f) => f.id === fieldValue.fieldId);
    const scope = field?.scope ?? 'group';
    nextFieldValues[fieldValueKey(fieldValue.fieldId, scope, personIndex)] = fieldValue.value;
  }

  return {
    contactFirstName: payload.registration.contactFirstName,
    contactLastName: payload.registration.contactLastName,
    contactEmail: payload.registration.contactEmail,
    groupMembers: payload.registration.groupMembers.map((member) => ({
      name: member.name,
      email: member.email ?? '',
    })),
    fieldValues: nextFieldValues,
  };
}

export default function PublicEventManageRegistrationPage() {
  const { accessToken } = useParams<{ accessToken: string }>();
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();

  const [payload, setPayload] = useState<ManageRegistrationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  const [contactFirstName, setContactFirstName] = useState('');
  const [contactLastName, setContactLastName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  const contactFirstNameFieldId = useId();
  const contactLastNameFieldId = useId();
  const contactEmailFieldId = useId();

  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    setLoadError(null);
    api
      .get<ManageRegistrationPayload>(`/public/events/registrations/manage/${encodeURIComponent(accessToken)}`)
      .then((res) => {
        setPayload(res.data);
        const formState = applyPayloadToForm(res.data);
        setContactFirstName(formState.contactFirstName);
        setContactLastName(formState.contactLastName);
        setContactEmail(formState.contactEmail);
        setGroupMembers(formState.groupMembers);
        setFieldValues(formState.fieldValues);
        setCancelled(res.data.registration.status === 'cancelled');
      })
      .catch(() => setLoadError('Registration not found'))
      .finally(() => setLoading(false));
  }, [accessToken]);

  const sortedFields = useMemo(
    () => [...(payload?.event.registrationFields ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [payload?.event.registrationFields],
  );

  const groupSize = groupMembers.length + 1;
  const totalPeople = groupSize;
  const isEditable = payload?.registration.status !== 'cancelled' && !cancelled;

  const addGroupMember = () => {
    setGroupMembers((prev) => [...prev, { name: '', email: '' }]);
  };

  const removeGroupMember = (index: number) => {
    setGroupMembers((prev) => prev.filter((_, idx) => idx !== index));
    setFieldValues((prev) => {
      const next: Record<string, string> = {};
      Object.entries(prev).forEach(([key, value]) => {
        const dash = key.indexOf('-');
        if (dash === -1) {
          next[key] = value;
          return;
        }
        const fieldId = key.slice(0, dash);
        const personIndex = parseInt(key.slice(dash + 1), 10);
        if (personIndex === index + 1) return;
        if (personIndex > index + 1) {
          next[`${fieldId}-${personIndex - 1}`] = value;
          return;
        }
        next[key] = value;
      });
      return next;
    });
  };

  const updateGroupMember = (index: number, field: keyof GroupMember, value: string) => {
    setGroupMembers((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const setFieldVal = (field: EventRegistrationField, personIndex: number, value: string) => {
    setFieldValues((prev) => ({
      ...prev,
      [fieldValueKey(field.id, field.scope, personIndex)]: value,
    }));
  };

  const buildFieldValuesPayload = () => {
    const fvArray: Array<{
      fieldId: number;
      registrationMemberIndex?: number | null;
      value: string;
    }> = [];

    for (const [key, value] of Object.entries(fieldValues)) {
      if (value === '') continue;
      const dash = key.indexOf('-');
      if (dash === -1) {
        fvArray.push({ fieldId: parseInt(key, 10), value });
      } else {
        const fieldId = parseInt(key.slice(0, dash), 10);
        const registrationMemberIndex = parseInt(key.slice(dash + 1), 10);
        fvArray.push({ fieldId, registrationMemberIndex, value });
      }
    }
    return fvArray;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!accessToken || !payload || submitting || !isEditable) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const { data } = await api.patch<ManageRegistrationPayload>(
        `/public/events/registrations/manage/${encodeURIComponent(accessToken)}`,
        {
          contactFirstName: contactFirstName.trim(),
          contactLastName: contactLastName.trim(),
          contactEmail: contactEmail.trim(),
          groupMembers: groupMembers.length > 0
            ? groupMembers.map((m) => ({ name: m.name.trim(), email: m.email.trim() || null }))
            : [],
          fieldValues: buildFieldValuesPayload(),
        },
      );
      setPayload(data);
      showAlert('Registration updated', 'success');
    } catch (err: unknown) {
      setSubmitError(formatApiError(err, 'Unable to update registration'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelRegistration = async () => {
    if (!accessToken || !payload || cancelling || !payload.canCancel) return;

    const confirmed = await confirm({
      title: 'Cancel registration?',
      message:
        'This will cancel your registration for this event. Registering again may not be possible if the event is full. If you paid a registration fee, you should receive a full refund within a few business days.',
      confirmText: 'Cancel registration',
      cancelText: 'Keep registration',
      variant: 'danger',
    });
    if (!confirmed) return;

    setCancelling(true);
    setSubmitError(null);
    try {
      await api.post(`/public/events/registrations/manage/${encodeURIComponent(accessToken)}/cancel`);
      setCancelled(true);
      setPayload((prev) =>
        prev
          ? {
              ...prev,
              canCancel: false,
              registration: { ...prev.registration, status: 'cancelled' },
            }
          : prev,
      );
      showAlert('Registration cancelled', 'success');
    } catch (err: unknown) {
      setSubmitError(formatApiError(err, 'Unable to cancel registration'));
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <PublicLayout>
        <PublicStateCard title="Loading registration..." />
      </PublicLayout>
    );
  }

  if (loadError || !payload) {
    return (
      <PublicLayout>
        <PublicStateCard
          title="Registration not found"
          description="This link may be invalid or expired."
          action={
            <Link to="/events" className="text-primary-teal-link hover:underline">
              Browse events
            </Link>
          }
        />
      </PublicLayout>
    );
  }

  const { event, registration } = payload;

  return (
    <PublicLayout>
      <SeoMeta title={`Manage registration: ${event.title}`} />
      <div className="max-w-2xl mx-auto px-4 py-10">
        <Link to={`/events/${event.slug}`} className="text-sm text-primary-teal-link hover:underline mb-6 inline-block">
          &larr; Back to event
        </Link>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">Manage registration</h1>
        <p className="text-gray-600 mb-2">{event.title}</p>
        <p className="text-sm text-gray-600 mb-6">
          Status: <span className="font-medium text-gray-800">{formatStatusLabel(registration.status)}</span>
          {registration.status === 'waitlisted' && registration.waitlistPosition != null
            ? ` (#${registration.waitlistPosition} on waitlist)`
            : null}
        </p>

        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Keep this page private. Anyone with this link can view or change your registration.
        </div>

        {payload.receiptUrl && (
          <p className="mb-6 text-sm text-gray-700">
            <a href={payload.receiptUrl} className="text-primary-teal-link hover:underline">
              View payment receipt
            </a>
          </p>
        )}

        {cancelled || registration.status === 'cancelled' ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-6 text-gray-700">
            This registration has been cancelled.
          </div>
        ) : (
          <>
            {submitError && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6">{submitError}</div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField tone="public" label="First name" htmlFor={contactFirstNameFieldId} required>
                  <input
                    id={contactFirstNameFieldId}
                    type="text"
                    autoComplete="given-name"
                    required
                    value={contactFirstName}
                    onChange={(e) => setContactFirstName(e.target.value)}
                    className={publicInput}
                  />
                </FormField>

                <FormField tone="public" label="Last name" htmlFor={contactLastNameFieldId} required>
                  <input
                    id={contactLastNameFieldId}
                    type="text"
                    autoComplete="family-name"
                    required
                    value={contactLastName}
                    onChange={(e) => setContactLastName(e.target.value)}
                    className={publicInput}
                  />
                </FormField>
              </div>

              <FormField tone="public" label="Email address" htmlFor={contactEmailFieldId} required>
                <input
                  id={contactEmailFieldId}
                  type="email"
                  required
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  className={publicInput}
                />
              </FormField>

              {event.allowGroupRegistration === 1 && (
                <div className="border border-gray-200 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-gray-900">Group members</h3>
                    <button
                      type="button"
                      onClick={addGroupMember}
                      disabled={event.maxGroupSize ? groupSize >= event.maxGroupSize : false}
                      className="text-sm text-primary-teal-link hover:underline disabled:opacity-50"
                    >
                      + Add member
                    </button>
                  </div>
                  {groupMembers.map((member, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <input
                        type="text"
                        placeholder="Name"
                        required
                        value={member.name}
                        onChange={(e) => updateGroupMember(i, 'name', e.target.value)}
                        className={`${publicInput} flex-1`}
                      />
                      <input
                        type="email"
                        placeholder="Email (optional)"
                        value={member.email}
                        onChange={(e) => updateGroupMember(i, 'email', e.target.value)}
                        className={`${publicInput} flex-1`}
                      />
                      <button
                        type="button"
                        onClick={() => removeGroupMember(i)}
                        className="text-red-500 hover:text-red-700 px-2 py-2"
                        aria-label={`Remove group member ${i + 1}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {groupMembers.length === 0 && (
                    <p className="text-sm text-gray-500">No additional group members added.</p>
                  )}
                </div>
              )}

              {sortedFields.map((field) => {
                if (isSubheadingFieldType(field.field_type)) {
                  return (
                    <div key={`h-${field.id}`} className="pt-2">
                      <h3 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2">{field.label}</h3>
                    </div>
                  );
                }

                if (field.scope === 'individual') {
                  return (
                    <div key={field.id} className="space-y-4">
                      {Array.from({ length: totalPeople }, (_, personIndex) => (
                        <div
                          key={`${field.id}-${personIndex}`}
                          className="rounded-lg border border-gray-100 bg-gray-50/80 p-4 space-y-3"
                        >
                          <p className="text-sm font-medium text-gray-800">{personLabel(personIndex)}</p>
                          <PublicRegistrationFieldInput
                            field={field}
                            fieldGroupKey={fieldValueKey(field.id, field.scope, personIndex)}
                            value={fieldValues[fieldValueKey(field.id, field.scope, personIndex)] || ''}
                            onChange={(v) => setFieldVal(field, personIndex, v)}
                          />
                        </div>
                      ))}
                    </div>
                  );
                }

                return (
                  <PublicRegistrationFieldInput
                    key={field.id}
                    field={field}
                    fieldGroupKey={fieldValueKey(field.id, field.scope, 0)}
                    value={fieldValues[fieldValueKey(field.id, field.scope, 0)] || ''}
                    onChange={(v) => setFieldVal(field, 0, v)}
                  />
                );
              })}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 bg-primary-teal text-white font-medium rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
              >
                {submitting ? 'Saving...' : 'Save changes'}
              </button>
            </form>

            <div className="mt-10 border-t border-gray-200 pt-8">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Cancel registration</h2>
              {payload.canCancel ? (
                <>
                  <p className="text-sm text-gray-600 mb-4">
                    You can cancel before the cancellation cutoff. If you paid a fee, a full refund will be processed
                    within a few business days.
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleCancelRegistration()}
                    disabled={cancelling}
                    className="px-4 py-2 rounded-lg border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    {cancelling ? 'Cancelling...' : 'Cancel registration'}
                  </button>
                </>
              ) : payload.cancellationCutoffPassed ? (
                <p className="text-sm text-gray-700">
                  The cancellation cutoff has passed. To request changes or discuss your registration, contact{' '}
                  <a href={`mailto:${event.pointOfContact}`} className="text-primary-teal-link hover:underline">
                    {event.pointOfContact}
                  </a>
                  .
                </p>
              ) : (
                <p className="text-sm text-gray-600">Cancellation is not available for this registration.</p>
              )}
            </div>
          </>
        )}
      </div>
    </PublicLayout>
  );
}
