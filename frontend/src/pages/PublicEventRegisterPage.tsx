import { FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import FormField from '../components/FormField';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import SeoMeta from '../components/SeoMeta';
import { useAuth } from '../contexts/AuthContext';
import PublicNotFoundPage from './PublicNotFoundPage';
import api, { formatApiError } from '../utils/api';
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
import {
  defaultTeamNameFromLastName,
  isSubheadingFieldType,
} from '../utils/eventRegistrationFieldPresets';
import { resolveEventContactFieldLabels } from '../utils/eventRegistrationContactLabels';
import { formatLinkedSessionWhen } from '../utils/eventLinkedSessionLabel';

const publicInput = publicEventRegistrationInput;

interface EventField extends EventRegistrationField {}

interface EventDetail {
  id: number;
  title: string;
  slug: string;
  feeMinor: number;
  memberFeeMinor?: number | null;
  yourFeeMinor?: number | null;
  currency: string;
  capacity: number | null;
  enableWaitlist: number;
  allowGroupRegistration: number;
  maxGroupSize: number | null;
  termsArticleId: number | null;
  contactFirstNameLabel?: string | null;
  contactLastNameLabel?: string | null;
  contactEmailLabel?: string | null;
  registrationFields: EventField[];
  confirmedCount: number;
  waitlistedCount?: number;
  openSpots?: number | null;
  registrationStart: string | null;
  registrationCutoff: string | null;
  timespans?: Array<{ start_dt: string; end_dt?: string; sort_order?: number }>;
  serverNow?: string;
}

interface SpecialLinkInfo {
  valid: boolean;
  reason?: 'used' | 'invalidated';
  overrideFeeminor?: number | null;
  maxGroupSize?: number | null;
  bypassCapacity?: boolean;
  ignoreRegistrationDates?: boolean;
}


const MS_HOUR = 60 * 60 * 1000;

function formatFee(feeMinor: number, currency: string): string {
  if (feeMinor <= 0) return 'Free';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'usd',
  }).format(feeMinor / 100);
}

function effectiveRegistrationCutoff(event: {
  registrationCutoff: string | null;
  timespans?: Array<{ start_dt: string }>;
}): string | null {
  return event.registrationCutoff || event.timespans?.[0]?.start_dt || null;
}

function formatMmSsRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function formatRegistrationOpensDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatRegistrationClosedDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function PublicEventRegisterPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const specialLinkToken = searchParams.get('slk');
  const { member } = useAuth();

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [specialLink, setSpecialLink] = useState<SpecialLinkInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  /** Initial GET /public/events/:slug failed — show full-page not found. */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** POST /register failed — show message on the form only. */
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [waitlistPosition, setWaitlistPosition] = useState<number | null>(null);

  const [contactFirstName, setContactFirstName] = useState('');
  const [contactLastName, setContactLastName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [groupMembers, setGroupMembers] = useState<AdditionalRegistrant[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const teamNameTouchedRef = useRef<Set<string>>(new Set());
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [tick, setTick] = useState(0);
  const contactFirstNameFieldId = useId();
  const contactLastNameFieldId = useId();
  const contactEmailFieldId = useId();

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setLoadError(null);
    setSubmitError(null);
    const eventUrl = specialLinkToken
      ? `/public/events/${slug}?slk=${encodeURIComponent(specialLinkToken)}`
      : `/public/events/${slug}`;
    const fetchEvent = api.get(eventUrl).then((res) => {
      const data = res.data;
      setEvent(data);
      if (data?.serverNow) {
        setServerOffsetMs(new Date(data.serverNow as string).getTime() - Date.now());
      } else {
        setServerOffsetMs(0);
      }
    });
    const fetchLink = specialLinkToken
      ? api.get(`/public/events/${slug}/special-link/${specialLinkToken}`)
          .then((res) => setSpecialLink(res.data))
          .catch(() => setSpecialLink({ valid: false, reason: 'used' }))
      : Promise.resolve();

    Promise.all([fetchEvent, fetchLink])
      .catch(() => setLoadError('Event not found'))
      .finally(() => setLoading(false));
  }, [slug, specialLinkToken]);

  useEffect(() => {
    if (!event || !member) return;
    const nameParts = member.name.trim().split(/\s+/);
    const firstFromName = nameParts[0] ?? '';
    const lastFromName = nameParts.slice(1).join(' ');
    if (firstFromName) setContactFirstName((prev) => prev || firstFromName);
    if (lastFromName) setContactLastName((prev) => prev || lastFromName);
    if (member.email) setContactEmail((prev) => prev || member.email || '');
    const phone = member.phone?.trim();
    if (!phone) return;
    setFieldValues((prev) => {
      const next = { ...prev };
      const total = 1 + groupMembers.length;
      for (const f of event.registrationFields) {
        if (f.field_type !== 'preset_phone') continue;
        if (f.scope === 'individual') {
          for (let p = 0; p < total; p += 1) {
            const k = fieldValueKey(f.id, f.scope, p);
            if (!next[k]) next[k] = phone;
          }
        } else {
          const k = fieldValueKey(f.id, f.scope, 0);
          if (!next[k]) next[k] = phone;
        }
      }
      return next;
    });
  }, [event, groupMembers.length, member]);

  const setVal = useCallback((key: string, v: string) => {
    setFieldValues((prev) => ({ ...prev, [key]: v }));
  }, []);

  const setFieldVal = useCallback(
    (field: EventField, personIndex: number, v: string, userEdited = true) => {
      const key = fieldValueKey(field.id, field.scope, personIndex);
      if (field.field_type === 'preset_team_name' && userEdited) {
        teamNameTouchedRef.current.add(key);
      }
      setVal(key, v);
    },
    [setVal],
  );

  useEffect(() => {
    if (!event) return;
    const total = 1 + groupMembers.length;
    setFieldValues((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const field of event.registrationFields) {
        if (field.field_type !== 'preset_team_name') continue;
        if (field.scope === 'individual') {
          for (let personIndex = 0; personIndex < total; personIndex += 1) {
            const key = fieldValueKey(field.id, field.scope, personIndex);
            if (teamNameTouchedRef.current.has(key)) continue;
            const personLastName =
              personIndex === 0 ? contactLastName : groupMembers[personIndex - 1]?.lastName ?? '';
            const defaultValue = defaultTeamNameFromLastName(personLastName);
            if (next[key] !== defaultValue) {
              next[key] = defaultValue;
              changed = true;
            }
          }
        } else {
          const key = fieldValueKey(field.id, field.scope, 0);
          if (teamNameTouchedRef.current.has(key)) continue;
          const defaultValue = defaultTeamNameFromLastName(contactLastName);
          if (next[key] !== defaultValue) {
            next[key] = defaultValue;
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [event, contactLastName, groupMembers]);

  const sortedFields = useMemo(() => {
    if (!event?.registrationFields) return [];
    return [...event.registrationFields].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }, [event]);

  const contactLabels = useMemo(() => resolveEventContactFieldLabels(event), [event]);

  const serverNowMs = useMemo(() => {
    void tick;
    return Date.now() + serverOffsetMs;
  }, [serverOffsetMs, tick]);

  const registrationTiming = useMemo(() => {
    if (!event) {
      return {
        ignoreDates: false,
        hasNotOpenedYet: false,
        isPastCutoff: false,
        msUntilOpen: -1,
        isPrefillWindow: false,
        isFutureOpening: false,
        isClosedForRegistration: false,
      };
    }
    const ignoreDates = !!(specialLink?.valid && specialLink.ignoreRegistrationDates);
    const registrationStartMs = event.registrationStart
      ? new Date(event.registrationStart).getTime()
      : null;
    const cutoffIso = effectiveRegistrationCutoff(event);
    const registrationCutoffMs = cutoffIso ? new Date(cutoffIso).getTime() : null;
    const hasNotOpenedYet =
      registrationStartMs !== null && serverNowMs < registrationStartMs;
    const isPastCutoff =
      registrationCutoffMs !== null && serverNowMs > registrationCutoffMs;
    const msUntilOpen =
      registrationStartMs !== null ? registrationStartMs - serverNowMs : -1;
    const isPrefillWindow =
      !ignoreDates && hasNotOpenedYet && msUntilOpen > 0 && msUntilOpen <= MS_HOUR;
    const isFutureOpening = !ignoreDates && hasNotOpenedYet && msUntilOpen > MS_HOUR;
    const isClosedForRegistration = !ignoreDates && isPastCutoff;

    return {
      ignoreDates,
      hasNotOpenedYet,
      isPastCutoff,
      msUntilOpen,
      isPrefillWindow,
      isFutureOpening,
      isClosedForRegistration,
    };
  }, [event, specialLink, serverNowMs]);

  useEffect(() => {
    if (!event?.registrationStart) return;
    if (specialLink?.valid && specialLink.ignoreRegistrationDates) return;
    const startMs = new Date(event.registrationStart).getTime();
    if (Date.now() + serverOffsetMs >= startMs) return;
    const id = window.setInterval(() => {
      setTick((x) => x + 1);
      if (Date.now() + serverOffsetMs >= startMs) {
        window.clearInterval(id);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [event?.registrationStart, event?.id, serverOffsetMs, specialLink?.valid, specialLink?.ignoreRegistrationDates]);

  const totalPeople = 1 + groupMembers.length;
  const groupSize = groupMembers.length + 1;
  const bypassCapacity = !!(specialLink?.valid && specialLink?.bypassCapacity);
  const openSpots =
    event?.capacity == null || bypassCapacity
      ? null
      : event.openSpots != null
        ? event.openSpots
        : Math.max(0, event.capacity - event.confirmedCount - (event.waitlistedCount ?? 0));

  /**
   * Waitlist only when the event is already full for a solo registration.
   * Growing the group past remaining spots is blocked in the UI instead of flipping to waitlist.
   */
  const registeringAsWaitlist =
    !!event &&
    event.capacity != null &&
    !bypassCapacity &&
    event.enableWaitlist === 1 &&
    (openSpots != null ? openSpots < 1 : false);

  if (loading) {
    return (
      <PublicLayout>
        <div className="max-w-2xl mx-auto px-4 py-16">
          <PublicStateCard
            title="Loading registration..."
            description="Preparing the event details and registration form."
          />
        </div>
      </PublicLayout>
    );
  }

  if (loadError || !event) {
    return (
      <PublicNotFoundPage
        title="Event not found"
        description="The registration page could not be loaded because this event is unavailable."
        seoTitle="Event not found | Triangle Curling Club"
        showCode={false}
      />
    );
  }

  if (specialLinkToken && specialLink && !specialLink.valid) {
    return (
      <PublicLayout>
        <SeoMeta title={event.title} />
        <div className="max-w-2xl mx-auto px-4 py-16 text-center">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-8">
            <h1 className="text-2xl font-bold text-amber-800 mb-4">
              {specialLink.reason === 'used' ? 'Link already used' : 'Link no longer valid'}
            </h1>
            <p className="text-amber-700">
              {specialLink.reason === 'used'
                ? 'This registration link has already been used. Each link can only be used once.'
                : 'This registration link has been invalidated and can no longer be used.'}
            </p>
          </div>
        </div>
      </PublicLayout>
    );
  }

  if (!registrationTiming.ignoreDates && registrationTiming.isClosedForRegistration) {
    const closedIso = effectiveRegistrationCutoff(event);
    return (
      <PublicLayout>
        <SeoMeta title={`Registration: ${event.title}`} />
        <div className="max-w-2xl mx-auto px-4 py-10">
          <Link to={`/events/${slug}`} className="text-sm text-primary-teal-link hover:underline mb-6 inline-block">
            &larr; Back to event
          </Link>
          <p className="text-gray-800 text-lg leading-relaxed">
            Registration for <span className="font-semibold">{event.title}</span> closed on{' '}
            {closedIso ? formatRegistrationClosedDateTime(closedIso) : 'the scheduled close time'}.
          </p>
        </div>
      </PublicLayout>
    );
  }

  if (!registrationTiming.ignoreDates && registrationTiming.isFutureOpening && event.registrationStart) {
    return (
      <PublicLayout>
        <SeoMeta title={`Registration: ${event.title}`} />
        <div className="max-w-2xl mx-auto px-4 py-10">
          <Link to={`/events/${slug}`} className="text-sm text-primary-teal-link hover:underline mb-6 inline-block">
            &larr; Back to event
          </Link>
          <p className="text-gray-800 text-lg leading-relaxed">
            Registration for <span className="font-semibold">{event.title}</span> opens on{' '}
            {formatRegistrationOpensDateTime(event.registrationStart)}.
          </p>
        </div>
      </PublicLayout>
    );
  }

  const effectiveFee = specialLink?.valid && specialLink?.overrideFeeminor !== null && specialLink?.overrideFeeminor !== undefined
    ? specialLink.overrideFeeminor
    : event.yourFeeMinor != null
      ? event.yourFeeMinor
      : event.feeMinor;
  const totalFee = effectiveFee * groupSize;

  const configuredMaxGroupSize =
    specialLink?.valid && specialLink?.maxGroupSize != null
      ? event.maxGroupSize != null
        ? Math.min(event.maxGroupSize, specialLink.maxGroupSize)
        : specialLink.maxGroupSize
      : event.maxGroupSize;
  /** Cap group size by remaining open spots so adding people cannot push the form onto the waitlist. */
  const capacityLimitedMaxGroupSize =
    !registeringAsWaitlist && openSpots != null ? openSpots : null;
  const effectiveMaxGroupSize = (() => {
    const caps = [configuredMaxGroupSize, capacityLimitedMaxGroupSize].filter(
      (value): value is number => value != null,
    );
    return caps.length > 0 ? Math.min(...caps) : null;
  })();
  const limitedByCapacity =
    capacityLimitedMaxGroupSize != null &&
    effectiveMaxGroupSize === capacityLimitedMaxGroupSize &&
    (configuredMaxGroupSize == null || capacityLimitedMaxGroupSize <= configuredMaxGroupSize);
  const additionalRegistrantsLimitMessage = limitedByCapacity
    ? 'No additional spots are available'
    : null;

  const addGroupMember = () => {
    if (effectiveMaxGroupSize != null && groupSize >= effectiveMaxGroupSize) return;
    setGroupMembers([...groupMembers, emptyAdditionalRegistrant()]);
  };
  const removeGroupMember = (i: number) => setGroupMembers(groupMembers.filter((_, idx) => idx !== i));
  const updateGroupMember = (i: number, field: keyof AdditionalRegistrant, value: string) => {
    const updated = [...groupMembers];
    updated[i] = { ...updated[i], [field]: value };
    setGroupMembers(updated);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (registrationTiming.isPrefillWindow && registrationTiming.msUntilOpen > 0) return;

    setSubmitting(true);
    setSubmitError(null);

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

    try {
      const res = await api.post(`/public/events/${slug}/register`, {
        contactFirstName: contactFirstName.trim(),
        contactLastName: contactLastName.trim(),
        contactEmail: contactEmail.trim(),
        groupMembers: groupMembers.length > 0
          ? groupMembers.map((m) => ({
              firstName: m.firstName.trim(),
              lastName: m.lastName.trim(),
              email: m.email.trim(),
            }))
          : undefined,
        fieldValues: fvArray.length > 0 ? fvArray : undefined,
        specialLinkToken: specialLinkToken || undefined,
      });

      if (res.data?.checkoutUrl) {
        window.location.assign(res.data.checkoutUrl);
        return;
      }

      if (res.data?.status === 'waitlisted') {
        setWaitlistPosition(res.data.waitlistPosition);
      }
      setSuccess(true);
    } catch (err: unknown) {
      setSubmitError(formatApiError(err, 'Unable to complete registration'));
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <PublicLayout>
        <SeoMeta title={`Registered: ${event.title}`} />
        <div className="max-w-2xl mx-auto px-4 py-16 text-center">
          <div className="bg-green-50 border border-green-200 rounded-lg p-8">
            <h1 className="text-2xl font-bold text-green-800 mb-4">
              {waitlistPosition ? 'Added to Waitlist' : 'Registration Confirmed!'}
            </h1>
            {waitlistPosition ? (
              <p className="text-green-700">
                You are #{waitlistPosition} on the waitlist for <strong>{event.title}</strong>.
                We'll notify you if a spot opens up.
              </p>
            ) : (
              <p className="text-green-700">
                You are registered for <strong>{event.title}</strong>.
                A confirmation email has been sent to {contactEmail}.
              </p>
            )}
            <Link to={`/events/${slug}`} className="mt-6 inline-block text-primary-teal-link hover:underline">
              Back to event
            </Link>
          </div>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <SeoMeta title={registeringAsWaitlist ? `Waitlist: ${event.title}` : `Register: ${event.title}`} />
      <div className="mx-auto w-full min-w-0 max-w-3xl px-4 py-10 sm:min-w-[36rem]">
        <Link to={`/events/${slug}`} className="text-sm text-primary-teal-link hover:underline mb-6 inline-block">
          &larr; Back to event
        </Link>

        {registrationTiming.isPrefillWindow && (
          <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
            Registration will open soon. You may prefill this form and submit as soon as the registration period opens.
          </div>
        )}

        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          {registeringAsWaitlist ? `Join waitlist for ${event.title}` : `Register for ${event.title}`}
        </h1>
        {event.timespans && event.timespans.length > 0 ? (
          <p className="text-gray-600 mb-2">{formatLinkedSessionWhen(event.timespans)}</p>
        ) : null}
        {registeringAsWaitlist ? (
          <div className="mb-8 space-y-2">
            <p className="text-gray-700">
              This event is full. Submitting this form adds you to the waitlist. Joining the waitlist is free—there is no
              payment to join.
            </p>
            <p className="text-sm text-gray-600">
              If a spot opens for your group, we may contact you to confirm and collect the event fee (
              {totalFee > 0 ? (
                <>
                  {formatFee(totalFee, event.currency)}
                  {groupSize > 1 ? ` total, ${formatFee(effectiveFee, event.currency)} per person` : ''}
                </>
              ) : (
                'none for this event'
              )}
              ) at that time.
            </p>
          </div>
        ) : (
          <p className="text-gray-600 mb-8">
            {totalFee > 0 ? `Fee: ${formatFee(totalFee, event.currency)}` : 'Free event'}
            {groupSize > 1 && totalFee > 0 && ` (${formatFee(effectiveFee, event.currency)} per person)`}
            {event.yourFeeMinor != null &&
              event.yourFeeMinor < event.feeMinor &&
              !(specialLink?.valid && specialLink?.overrideFeeminor != null && specialLink?.overrideFeeminor !== undefined) && (
                <span className="block text-sm mt-1 text-gray-500">
                  Logged-in member rate applies (otherwise {formatFee(event.feeMinor * groupSize, event.currency)}
                  {groupSize > 1 ? ` total, ${formatFee(event.feeMinor, event.currency)} per person` : ''}).
                </span>
              )}
          </p>
        )}

        {submitError && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6">
            {submitError}
          </div>
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
            <AdditionalRegistrantsSection
              members={groupMembers}
              labels={contactLabels}
              onAdd={addGroupMember}
              onRemove={removeGroupMember}
              onChange={updateGroupMember}
              maxGroupSize={effectiveMaxGroupSize}
              limitMessage={additionalRegistrantsLimitMessage}
              perPersonFeeMinor={registeringAsWaitlist ? null : effectiveFee}
              currency={event.currency}
            />
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

          {event.termsArticleId && (
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={acceptTerms}
                onChange={(e) => setAcceptTerms(e.target.checked)}
                className="mt-1"
                required
              />
              <span className="text-sm text-gray-700">
                I agree to the{' '}
                <a
                  href={`/articles/${event.termsArticleId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-teal-link hover:underline"
                >
                  terms and conditions
                </a>
              </span>
            </label>
          )}

          <button
            type="submit"
            disabled={
              submitting ||
              (registrationTiming.isPrefillWindow && registrationTiming.msUntilOpen > 0) ||
              (!!event.termsArticleId && !acceptTerms)
            }
            className="w-full py-3 bg-primary-teal-solid text-white font-medium rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50 tabular-nums"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {submitting
              ? 'Processing...'
              : registeringAsWaitlist
                ? registrationTiming.isPrefillWindow && registrationTiming.msUntilOpen > 0
                  ? `Join waitlist (${formatMmSsRemaining(registrationTiming.msUntilOpen)})`
                  : 'Join waitlist'
                : registrationTiming.isPrefillWindow &&
                    registrationTiming.msUntilOpen > 0 &&
                    totalFee > 0
                  ? `Register & Pay ${formatFee(totalFee, event.currency)} (${formatMmSsRemaining(registrationTiming.msUntilOpen)})`
                  : registrationTiming.isPrefillWindow &&
                      registrationTiming.msUntilOpen > 0 &&
                      totalFee <= 0
                    ? `Register (${formatMmSsRemaining(registrationTiming.msUntilOpen)})`
                    : totalFee > 0
                      ? `Register & Pay ${formatFee(totalFee, event.currency)}`
                      : 'Register'}
          </button>
        </form>
      </div>
    </PublicLayout>
  );
}

