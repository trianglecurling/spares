import { FormEvent, useEffect, useId, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import ChoiceInput from '../components/ChoiceInput';
import FormField from '../components/FormField';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import SeoMeta from '../components/SeoMeta';
import AdditionalRegistrantsSection, {
  emptyAdditionalRegistrant,
  type AdditionalRegistrant,
} from '../components/eventRegistration/AdditionalRegistrantsSection';
import PublicRegistrationFieldInput, {
  publicEventRegistrationInput,
  fieldValueKey,
  personLabel,
  type EventRegistrationField,
} from '../components/eventRegistration/PublicRegistrationFieldInput';
import { isSubheadingFieldType } from '../utils/eventRegistrationFieldPresets';
import { resolveEventContactFieldLabels } from '../utils/eventRegistrationContactLabels';
import { formatLinkedSessionEventLabel, formatLinkedSessionWhen } from '../utils/eventLinkedSessionLabel';
import api, { formatApiError } from '../utils/api';
import { useAlert } from '../contexts/AlertContext';
import { useConfirm } from '../contexts/ConfirmContext';

const publicInput = publicEventRegistrationInput;
const PAYMENT_POLL_INTERVAL_MS = 2000;
const PAYMENT_MAX_POLL_ATTEMPTS = 15;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

interface ManageRegistrationPayload {
  event: {
    id: number;
    title: string;
    slug: string;
    allowGroupRegistration: number;
    maxGroupSize: number | null;
    capacity?: number | null;
    feeMinor?: number;
    memberFeeMinor?: number | null;
    currency?: string;
    contactFirstNameLabel?: string | null;
    contactLastNameLabel?: string | null;
    contactEmailLabel?: string | null;
    registrationFields: EventRegistrationField[];
    cancellationCutoff: string | null;
    pointOfContact: string;
    timespans?: Array<{ start_dt: string; end_dt?: string; sort_order?: number }>;
  };
  registration: {
    id: number;
    status: string;
    contactFirstName: string;
    contactLastName: string;
    contactEmail: string;
    groupSize?: number;
    perPersonFeeMinor?: number;
    groupMembers: AdditionalRegistrant[];
    fieldValues: Array<{ fieldId: number; registrationMemberIndex: number | null; value: string }>;
    waitlistPosition: number | null;
    waitlistLength?: number | null;
  };
  openSpots?: number | null;
  balanceDueMinor?: number;
  receiptUrl: string | null;
  isWaitlistEntry?: boolean;
  canCancel: boolean;
  canSwitchSession?: boolean;
  cancellationCutoffPassed: boolean;
  serverNow: string;
  checkoutUrl?: string | null;
  paymentStatus?: string;
  orderToken?: string;
  feeAdjustment?: {
    previousGroupSize: number;
    groupSize: number;
    perPersonFeeMinor: number;
    feeDeltaMinor: number;
    refundIssued: boolean;
    refundAmountMinor: number;
    refundError: string | null;
  };
}

function formatMoney(amountMinor: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: (currency || 'usd').toUpperCase(),
  }).format(amountMinor / 100);
}

type TransferSessionOption = {
  eventId: number;
  title: string;
  slug: string;
  timespans: Array<{ start_dt: string; end_dt: string; sort_order: number }>;
  openSpots: number | null;
  waitlistEnabled: boolean;
  eligible: boolean;
  ineligibleReason: string | null;
  resultingStatus: 'confirmed' | 'waitlisted' | null;
};

function formatStatusLabel(status: string): string {
  switch (status) {
    case 'confirmed':
      return 'Confirmed';
    case 'waitlisted':
      return 'Waitlisted';
    case 'pending_payment':
      return 'Pending payment';
    case 'cancelled':
      return 'Canceled';
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
      firstName: member.firstName,
      lastName: member.lastName,
      email: member.email ?? '',
    })),
    fieldValues: nextFieldValues,
  };
}

export default function PublicEventManageRegistrationPage() {
  const { accessToken } = useParams<{ accessToken: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();

  const checkoutSessionId = searchParams.get('session_id')?.trim() || '';
  const checkoutOrderToken = searchParams.get('orderToken')?.trim() || '';
  const needsCheckoutResolve = Boolean(checkoutSessionId || checkoutOrderToken);

  const [payload, setPayload] = useState<ManageRegistrationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [canceled, setCanceled] = useState(false);
  const [cancelRefundIssued, setCancelRefundIssued] = useState(false);
  const [cancelRefundError, setCancelRefundError] = useState<string | null>(null);
  const [verifyingPayment, setVerifyingPayment] = useState(needsCheckoutResolve);
  const [paymentStillProcessing, setPaymentStillProcessing] = useState(false);

  const [contactFirstName, setContactFirstName] = useState('');
  const [contactLastName, setContactLastName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [groupMembers, setGroupMembers] = useState<AdditionalRegistrant[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [transferSessions, setTransferSessions] = useState<TransferSessionOption[]>([]);
  const [transferSessionsLoading, setTransferSessionsLoading] = useState(false);
  const [transferTargetEventId, setTransferTargetEventId] = useState<number | null>(null);

  const contactFirstNameFieldId = useId();
  const contactLastNameFieldId = useId();
  const contactEmailFieldId = useId();
  const transferTargetFieldId = useId();

  const applyManagePayload = (data: ManageRegistrationPayload) => {
    setPayload(data);
    const formState = applyPayloadToForm(data);
    setContactFirstName(formState.contactFirstName);
    setContactLastName(formState.contactLastName);
    setContactEmail(formState.contactEmail);
    setGroupMembers(formState.groupMembers);
    setFieldValues(formState.fieldValues);
    setCanceled(data.registration.status === 'cancelled');
  };

  const clearCheckoutReturnParams = () => {
    if (!checkoutSessionId && !checkoutOrderToken) return;
    const next = new URLSearchParams(searchParams);
    next.delete('session_id');
    next.delete('orderToken');
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    setLoadError(null);
    api
      .get<ManageRegistrationPayload>(`/public/events/registrations/manage/${encodeURIComponent(accessToken)}`)
      .then((res) => {
        applyManagePayload(res.data);
      })
      .catch(() => setLoadError('Registration not found'))
      .finally(() => setLoading(false));
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken || !needsCheckoutResolve || loading) return;

    let cancelled = false;

    const resolveOnce = async (): Promise<ManageRegistrationPayload> => {
      const { data } = await api.post<ManageRegistrationPayload>(
        `/public/events/registrations/manage/${encodeURIComponent(accessToken)}/resolve`,
        {
          ...(checkoutSessionId ? { sessionId: checkoutSessionId } : {}),
          ...(checkoutOrderToken ? { orderToken: checkoutOrderToken } : {}),
        },
      );
      return data;
    };

    const poll = async () => {
      setVerifyingPayment(true);
      setPaymentStillProcessing(false);

      for (let attempt = 1; attempt <= PAYMENT_MAX_POLL_ATTEMPTS; attempt += 1) {
        if (cancelled) return;
        try {
          const data = await resolveOnce();
          if (cancelled) return;

          applyManagePayload(data);

          const paymentStatus = data.paymentStatus;
          const balanceCleared = (data.balanceDueMinor ?? 0) <= 0;
          const paymentSucceeded =
            paymentStatus === 'succeeded' ||
            paymentStatus === 'partially_refunded' ||
            paymentStatus === 'refunded';

          if (paymentStatus === 'failed') {
            setSubmitError('Payment did not complete. Save changes again to retry checkout.');
            setVerifyingPayment(false);
            clearCheckoutReturnParams();
            return;
          }

          if (paymentSucceeded || balanceCleared) {
            setVerifyingPayment(false);
            clearCheckoutReturnParams();
            if (paymentSucceeded && balanceCleared) {
              showAlert('Additional payment received', 'success');
            }
            return;
          }

          if (attempt < PAYMENT_MAX_POLL_ATTEMPTS) {
            await sleep(PAYMENT_POLL_INTERVAL_MS);
          }
        } catch {
          if (cancelled) return;
          if (attempt < PAYMENT_MAX_POLL_ATTEMPTS) {
            await sleep(PAYMENT_POLL_INTERVAL_MS);
          }
        }
      }

      if (!cancelled) {
        setVerifyingPayment(false);
        setPaymentStillProcessing(true);
        clearCheckoutReturnParams();
      }
    };

    void poll();

    return () => {
      cancelled = true;
    };
    // Intentionally keyed to checkout return params + initial load completion.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clear/search helpers close over current params
  }, [accessToken, needsCheckoutResolve, loading, checkoutSessionId, checkoutOrderToken]);

  useEffect(() => {
    if (!accessToken || !payload?.canSwitchSession || payload.registration.status === 'cancelled') {
      setTransferSessions([]);
      setTransferTargetEventId(null);
      return;
    }

    let cancelled = false;
    setTransferSessionsLoading(true);
    api
      .get<{ sessions: TransferSessionOption[] }>(
        `/public/events/registrations/manage/${encodeURIComponent(accessToken)}/transfer-options`,
      )
      .then((res) => {
        if (cancelled) return;
        const sessions = res.data.sessions || [];
        setTransferSessions(sessions);
        setTransferTargetEventId(null);
      })
      .catch(() => {
        if (!cancelled) {
          setTransferSessions([]);
          setTransferTargetEventId(null);
        }
      })
      .finally(() => {
        if (!cancelled) setTransferSessionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, payload?.canSwitchSession, payload?.registration.status, payload?.event.id]);

  const sortedFields = useMemo(
    () => [...(payload?.event.registrationFields ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [payload?.event.registrationFields],
  );

  const groupSize = groupMembers.length + 1;
  const totalPeople = groupSize;
  const isCanceled = payload?.registration.status === 'cancelled' || canceled;
  const isEditable = !isCanceled;

  const addGroupMember = () => {
    setGroupMembers((prev) => [...prev, emptyAdditionalRegistrant()]);
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

  const updateGroupMember = (index: number, field: keyof AdditionalRegistrant, value: string) => {
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

  const savedGroupSize = payload?.registration.groupSize ?? (payload?.registration.groupMembers.length ?? 0) + 1;
  const perPersonFeeMinor = payload?.registration.perPersonFeeMinor ?? 0;
  const currency = payload?.event.currency || 'usd';
  const draftGroupSize = groupMembers.length + 1;
  const groupSizeDelta = draftGroupSize - savedGroupSize;
  const balanceDueMinor = payload?.balanceDueMinor ?? 0;
  // Matches backend: expected total minus paid net (includes any unpaid balance from a prior add).
  const feeDeltaMinor =
    payload?.registration.status === 'confirmed' && perPersonFeeMinor > 0
      ? perPersonFeeMinor * groupSizeDelta + balanceDueMinor
      : 0;
  const capacityLimitedMaxGroupSize =
    payload?.registration.status === 'confirmed' && payload.openSpots != null
      ? savedGroupSize + Math.max(0, payload.openSpots)
      : null;
  const effectiveMaxGroupSize = (() => {
    const caps = [payload?.event.maxGroupSize ?? null, capacityLimitedMaxGroupSize].filter(
      (value): value is number => value != null,
    );
    return caps.length > 0 ? Math.min(...caps) : null;
  })();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!accessToken || !payload || submitting || !isEditable) return;

    if (groupSizeDelta > 0 && payload.registration.status === 'confirmed') {
      const openSpots = payload.openSpots;
      if (openSpots != null && groupSizeDelta > openSpots) {
        setSubmitError(
          openSpots <= 0
            ? 'There are no open spots left to add more people.'
            : `Only ${openSpots} open ${openSpots === 1 ? 'spot is' : 'spots are'} available.`,
        );
        return;
      }
    }

    if (groupSizeDelta < 0 && feeDeltaMinor < 0) {
      const removedCount = Math.abs(groupSizeDelta);
      const refundAmount = Math.abs(feeDeltaMinor);
      const confirmed = await confirm({
        title: removedCount === 1 ? 'Remove registrant and refund?' : 'Remove registrants and refund?',
        message:
          `This removes ${removedCount} ${removedCount === 1 ? 'person' : 'people'} from your registration and issues a refund of ${formatMoney(refundAmount, currency)}. ` +
          'Refunds usually appear within a few business days.',
        confirmText: 'Remove and refund',
        cancelText: 'Keep current group',
        variant: 'danger',
      });
      if (!confirmed) return;
    } else if (feeDeltaMinor > 0) {
      const addedCount = Math.max(0, groupSizeDelta);
      const confirmed = await confirm({
        title:
          addedCount > 0
            ? addedCount === 1
              ? 'Add registrant and pay?'
              : 'Add registrants and pay?'
            : 'Complete additional payment?',
        message:
          (addedCount > 0
            ? `Adding ${addedCount} ${addedCount === 1 ? 'person' : 'people'} requires an additional payment of ${formatMoney(feeDeltaMinor, currency)}`
            : `An additional payment of ${formatMoney(feeDeltaMinor, currency)} is still due for your current group size`) +
          (perPersonFeeMinor > 0 && addedCount > 0
            ? ` (${formatMoney(perPersonFeeMinor, currency)} each). `
            : '. ') +
          'You will be taken to checkout to complete payment.',
        confirmText: 'Continue to payment',
        cancelText: addedCount > 0 ? 'Keep current group' : 'Not now',
      });
      if (!confirmed) return;
    }

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
            ? groupMembers.map((m) => ({
                firstName: m.firstName.trim(),
                lastName: m.lastName.trim(),
                email: m.email.trim(),
              }))
            : [],
          fieldValues: buildFieldValuesPayload(),
        },
      );

      if (data.checkoutUrl) {
        window.location.assign(data.checkoutUrl);
        return;
      }

      setPayload(data);
      const formState = applyPayloadToForm(data);
      setGroupMembers(formState.groupMembers);
      setFieldValues(formState.fieldValues);

      if (data.feeAdjustment?.refundIssued && data.feeAdjustment.refundAmountMinor > 0) {
        showAlert(
          `Registration updated. A refund of ${formatMoney(data.feeAdjustment.refundAmountMinor, currency)} has been initiated.`,
          'success',
        );
      } else if (data.feeAdjustment?.refundError) {
        showAlert(
          `Registration updated, but the refund failed: ${data.feeAdjustment.refundError}. Contact ${data.event.pointOfContact}.`,
          'warning',
        );
      } else {
        showAlert('Registration updated', 'success');
      }
    } catch (err: unknown) {
      setSubmitError(formatApiError(err, 'Unable to update registration'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSwitchSession = async () => {
    if (!accessToken || !payload || transferring || transferTargetEventId == null) return;
    const target = transferSessions.find((session) => session.eventId === transferTargetEventId);
    if (!target?.eligible) return;

    const waitlistNote =
      target.resultingStatus === 'waitlisted'
        ? ' The selected session is full, so you will be placed on its waitlist.'
        : '';
    const groupNote =
      draftGroupSize > 1
        ? ` All ${draftGroupSize} people on this registration will move together.`
        : '';
    const confirmed = await confirm({
      title: 'Switch session?',
      message: `Move your registration from "${payload.event.title}" to "${formatLinkedSessionEventLabel(target.title, target.timespans)}".${groupNote}${waitlistNote}`,
      confirmText: 'Switch session',
      cancelText: 'Keep current session',
    });
    if (!confirmed) return;

    setTransferring(true);
    setSubmitError(null);
    try {
      const { data } = await api.post<ManageRegistrationPayload>(
        `/public/events/registrations/manage/${encodeURIComponent(accessToken)}/transfer`,
        { targetEventId: transferTargetEventId },
      );
      setPayload(data);
      const formState = applyPayloadToForm(data);
      setContactFirstName(formState.contactFirstName);
      setContactLastName(formState.contactLastName);
      setContactEmail(formState.contactEmail);
      setGroupMembers(formState.groupMembers);
      setFieldValues(formState.fieldValues);
      showAlert(
        data.registration.status === 'waitlisted'
          ? 'Moved to the waitlist for the new session'
          : 'Registration moved to the new session',
        'success',
      );
    } catch (err: unknown) {
      setSubmitError(formatApiError(err, 'Unable to switch sessions'));
    } finally {
      setTransferring(false);
    }
  };

  const handleCancelRegistration = async () => {
    if (!accessToken || !payload || canceling || !payload.canCancel) return;

    const isWaitlistEntry = payload.isWaitlistEntry ?? payload.registration.status === 'waitlisted';
    const peopleCount = savedGroupSize;
    const groupCancelNote =
      peopleCount > 1
        ? ` This cancels the registration for all ${peopleCount} people in your group.`
        : '';

    const confirmed = await confirm({
      title: isWaitlistEntry ? 'Cancel waitlist entry?' : 'Cancel registration?',
      message: isWaitlistEntry
        ? `This will remove your waitlist entry for this event.${groupCancelNote} You will lose your place on the waitlist.`
        : `This will cancel your registration for this event.${groupCancelNote} Registering again may not be possible if the event is full. If you paid a registration fee, you should receive a full refund within a few business days.`,
      confirmText: isWaitlistEntry ? 'Cancel waitlist entry' : 'Cancel registration',
      cancelText: isWaitlistEntry ? 'Keep waitlist entry' : 'Keep registration',
      variant: 'danger',
    });
    if (!confirmed) return;

    setCanceling(true);
    setSubmitError(null);
    setCancelRefundError(null);
    setCancelRefundIssued(false);
    try {
      const { data: cancelResult } = await api.post<{
        success: boolean;
        refundIssued?: boolean;
        refundError?: string | null;
        refundAmountMinor?: number;
      }>(`/public/events/registrations/manage/${encodeURIComponent(accessToken)}/cancel`);
      const { data } = await api.get<ManageRegistrationPayload>(
        `/public/events/registrations/manage/${encodeURIComponent(accessToken)}`,
      );
      applyManagePayload(data);
      setCanceled(true);

      const refundIssued = Boolean(cancelResult.refundIssued);
      const refundError = cancelResult.refundError ?? null;
      setCancelRefundIssued(refundIssued);
      setCancelRefundError(refundError);

      if (isWaitlistEntry) {
        showAlert('Waitlist entry canceled', 'success');
      } else if (refundError) {
        showAlert(
          `Registration canceled, but the refund failed: ${refundError}. Contact ${data.event.pointOfContact}.`,
          'warning',
        );
      } else if (refundIssued) {
        showAlert('Registration canceled. A refund has been initiated.', 'success');
      } else {
        showAlert('Registration canceled', 'success');
      }
    } catch (err: unknown) {
      setSubmitError(formatApiError(err, 'Unable to cancel registration'));
    } finally {
      setCanceling(false);
    }
  };

  if (loading || verifyingPayment) {
    return (
      <PublicLayout>
        <PublicStateCard
          title={verifyingPayment ? 'Verifying your payment...' : 'Loading registration...'}
          description={
            verifyingPayment
              ? 'This usually takes a few seconds. Please keep this page open.'
              : undefined
          }
        />
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
  const contactLabels = resolveEventContactFieldLabels(event);
  const isWaitlistEntry = payload.isWaitlistEntry ?? registration.status === 'waitlisted';
  const isCanceledView = registration.status === 'cancelled' || canceled;
  const manageTitle = isWaitlistEntry ? 'Manage waitlist entry' : 'Manage registration';
  const cancelTitle = isWaitlistEntry ? 'Cancel waitlist entry' : 'Cancel registration';

  return (
    <PublicLayout>
      <SeoMeta title={`${manageTitle}: ${event.title}`} />
      <div className="mx-auto w-full min-w-0 max-w-3xl px-4 py-10 sm:min-w-[36rem]">
        <Link to={`/events/${event.slug}`} className="text-sm text-primary-teal-link hover:underline mb-6 inline-block">
          &larr; Back to event
        </Link>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">{manageTitle}</h1>

        {isCanceledView ? (
          <div
            className={`mb-6 rounded-lg border px-4 py-4 ${
              cancelRefundError
                ? 'border-amber-300 bg-amber-50 text-amber-950'
                : 'border-gray-200 bg-gray-50 text-gray-700'
            }`}
          >
            <p className="font-medium text-gray-900">
              {isWaitlistEntry ? 'This waitlist entry has been canceled.' : 'This registration has been canceled.'}
            </p>
            {!isWaitlistEntry && cancelRefundError ? (
              <p className="mt-2 text-sm">
                Your registration was canceled, but the refund could not be completed automatically
                {cancelRefundError ? ` (${cancelRefundError})` : ''}. Contact{' '}
                <a href={`mailto:${event.pointOfContact}`} className="text-primary-teal-link hover:underline">
                  {event.pointOfContact}
                </a>{' '}
                for help.
              </p>
            ) : !isWaitlistEntry && (cancelRefundIssued || payload.receiptUrl) ? (
              <p className="mt-2 text-sm">
                {cancelRefundIssued
                  ? 'A refund has been initiated and should appear within a few business days.'
                  : 'If you paid a registration fee, your refund should appear within a few business days.'}
                {payload.receiptUrl ? (
                  <>
                    {' '}
                    You can review refund details on your{' '}
                    <a href={payload.receiptUrl} className="text-primary-teal-link hover:underline">
                      refund receipt
                    </a>
                    .
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
        ) : null}

        <p className="text-gray-600 mb-2">{event.title}</p>
        {event.timespans && event.timespans.length > 0 ? (
          <p className="text-gray-600 mb-2">{formatLinkedSessionWhen(event.timespans)}</p>
        ) : null}
        <p className="text-sm text-gray-600 mb-6">
          Status: <span className="font-medium text-gray-800">{formatStatusLabel(registration.status)}</span>
          {registration.status === 'waitlisted' && registration.waitlistPosition != null
            ? registration.waitlistLength != null
              ? ` (#${registration.waitlistPosition} of ${registration.waitlistLength} on waitlist)`
              : ` (#${registration.waitlistPosition} on waitlist)`
            : null}
        </p>

        {paymentStillProcessing ? (
          <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <p className="font-medium">Payment is still processing</p>
            <p className="mt-1">
              Refresh this page in a moment. If the balance still shows as due, contact{' '}
              <a href={`mailto:${event.pointOfContact}`} className="text-primary-teal-link hover:underline">
                {event.pointOfContact}
              </a>
              .
            </p>
          </div>
        ) : null}

        {!isCanceledView && balanceDueMinor > 0 ? (
          <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <p className="font-medium">Additional payment due: {formatMoney(balanceDueMinor, currency)}</p>
            <p className="mt-1">
              Your group was updated, but payment was not completed. Save changes or continue below to finish checkout.
            </p>
          </div>
        ) : null}

        {!isCanceledView ? (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            Keep this page private. Anyone with this link can view or change your{' '}
            {isWaitlistEntry ? 'waitlist entry' : 'registration'}.
          </div>
        ) : null}

        {!isCanceledView && !isWaitlistEntry && payload.receiptUrl ? (
          <p className="mb-6 text-sm text-gray-700">
            <a href={payload.receiptUrl} className="text-primary-teal-link hover:underline">
              View payment receipt
            </a>
          </p>
        ) : null}

        {isCanceledView ? null : (
          <>
            {submitError && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6">{submitError}</div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField tone="public" label={contactLabels.firstName} htmlFor={contactFirstNameFieldId} required>
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

                <FormField tone="public" label={contactLabels.lastName} htmlFor={contactLastNameFieldId} required>
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

              <FormField tone="public" label={contactLabels.email} htmlFor={contactEmailFieldId} required>
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
                <div className="space-y-2">
                  <AdditionalRegistrantsSection
                    members={groupMembers}
                    labels={contactLabels}
                    onAdd={addGroupMember}
                    onRemove={removeGroupMember}
                    onChange={updateGroupMember}
                    maxGroupSize={effectiveMaxGroupSize ?? event.maxGroupSize}
                    perPersonFeeMinor={
                      registration.status === 'confirmed' ? perPersonFeeMinor : null
                    }
                    currency={currency}
                  />
                  {registration.status === 'confirmed' && perPersonFeeMinor > 0 ? (
                    <p className="text-sm text-gray-600">
                      Adding people requires an additional payment of {formatMoney(perPersonFeeMinor, currency)} each.
                      Removing people issues a refund for the unused spots. You will confirm before checkout or refund.
                    </p>
                  ) : null}
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
                className="w-full py-3 bg-primary-teal-solid text-white font-medium rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
              >
                {submitting ? 'Saving...' : 'Save changes'}
              </button>
            </form>

            {payload.canSwitchSession ? (
              <div className="mt-10 border-t border-gray-200 pt-8">
                <h2 className="text-lg font-semibold text-gray-900 mb-2">Switch session</h2>
                {transferSessionsLoading ? (
                  <p className="text-sm text-gray-600">Loading other sessions...</p>
                ) : transferSessions.filter((session) => session.eligible).length === 0 ? (
                  <p className="text-sm text-gray-600">
                    All other sessions are full. Please contact{' '}
                    <a
                      href={`mailto:${event.pointOfContact}`}
                      className="text-primary-teal-link hover:underline"
                    >
                      {event.pointOfContact}
                    </a>{' '}
                    if you need assistance.
                  </p>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-600">
                      Move this registration to another linked session of the same event. Your answers and payment
                      stay with you when fees match.
                      {draftGroupSize > 1
                        ? ` All ${draftGroupSize} people on this registration will switch together.`
                        : ''}
                    </p>
                    <FormField tone="public" label="New session" htmlFor={transferTargetFieldId} required>
                      <ChoiceInput
                        inputId={transferTargetFieldId}
                        layout="popover"
                        value={transferTargetEventId != null ? String(transferTargetEventId) : null}
                        onChange={(value) => {
                          if (value == null || Array.isArray(value)) {
                            setTransferTargetEventId(null);
                            return;
                          }
                          const next = Number.parseInt(value, 10);
                          setTransferTargetEventId(Number.isFinite(next) ? next : null);
                        }}
                        options={transferSessions
                          .filter((session) => session.eligible)
                          .map((session) => ({
                            value: String(session.eventId),
                            label: `${formatLinkedSessionEventLabel(session.title, session.timespans)}${
                              session.resultingStatus === 'waitlisted'
                                ? ' (waitlist)'
                                : session.openSpots != null
                                  ? ` (${session.openSpots} open)`
                                  : ''
                            }`,
                          }))}
                        placeholder="Choose another session"
                      />
                    </FormField>
                    <button
                      type="button"
                      onClick={() => void handleSwitchSession()}
                      disabled={
                        transferring ||
                        transferTargetEventId == null ||
                        !transferSessions.some(
                          (session) => session.eventId === transferTargetEventId && session.eligible,
                        )
                      }
                      className="px-4 py-2 rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {transferring ? 'Switching...' : 'Switch session'}
                    </button>
                  </div>
                )}
              </div>
            ) : null}

            <div className="mt-10 border-t border-gray-200 pt-8">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">{cancelTitle}</h2>
              {payload.canCancel ? (
                <>
                  <p className="text-sm text-gray-600 mb-4">
                    {isWaitlistEntry
                      ? savedGroupSize > 1
                        ? `You can cancel your waitlist entry at any time. This removes all ${savedGroupSize} people in your group from the waitlist.`
                        : 'You can cancel your waitlist entry at any time.'
                      : savedGroupSize > 1
                        ? `You can cancel before the cancellation cutoff. This cancels the registration for all ${savedGroupSize} people in your group. If you paid a fee, a full refund will be processed within a few business days.`
                        : 'You can cancel before the cancellation cutoff. If you paid a fee, a full refund will be processed within a few business days.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleCancelRegistration()}
                    disabled={canceling}
                    className="px-4 py-2 rounded-lg border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    {canceling ? 'Canceling...' : cancelTitle}
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
