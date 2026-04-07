import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout';
import SeoMeta from '../components/SeoMeta';
import api, { formatApiError } from '../utils/api';
import { TeamPlayersField, defaultTeamPlayersJson } from '../components/eventRegistration/TeamPlayersField';
import { isSubheadingFieldType, TEAM_POSITIONS_DOUBLES, TEAM_POSITIONS_FOUR } from '../utils/eventRegistrationFieldPresets';

const publicInput =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary-teal focus:outline-none focus:ring-2 focus:ring-primary-teal/20';

interface EventField {
  id: number;
  label: string;
  field_type: string;
  scope: string;
  required: number;
  options: string | null;
  sort_order?: number;
}

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
  registrationFields: EventField[];
  confirmedCount: number;
  registrationStart: string | null;
  registrationCutoff: string | null;
  timespans?: Array<{ start_dt: string }>;
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

interface GroupMember {
  name: string;
  email: string;
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

function fieldValueKey(fieldId: number, scope: string, personIndex: number): string {
  if (scope === 'individual') return `${fieldId}-${personIndex}`;
  return String(fieldId);
}

function personLabel(personIndex: number): string {
  if (personIndex === 0) return 'Primary registrant';
  return `Group member ${personIndex}`;
}

export default function PublicEventRegisterPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const specialLinkToken = searchParams.get('slk');

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

  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [tick, setTick] = useState(0);

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
    if (!event) return;
    const token = localStorage.getItem('authToken');
    if (!token) return;
    api
      .get('/members/me')
      .then((res) => {
        const m = res.data as { name?: string | null; email?: string | null; phone?: string | null };
        if (m?.name) setContactName((prev) => prev || m.name || '');
        if (m?.email) setContactEmail((prev) => prev || m.email || '');
        const phone = m?.phone?.trim();
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
      })
      .catch(() => {});
  }, [event, groupMembers.length]);

  const setVal = useCallback((key: string, v: string) => {
    setFieldValues((prev) => ({ ...prev, [key]: v }));
  }, []);

  const sortedFields = useMemo(() => {
    if (!event?.registrationFields) return [];
    return [...event.registrationFields].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }, [event]);

  const serverNowMs = useMemo(() => Date.now() + serverOffsetMs, [serverOffsetMs, tick]);

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

  /** Matches backend: waitlist when at capacity, waitlist enabled, and capacity not bypassed. */
  const registeringAsWaitlist =
    !!event &&
    event.capacity != null &&
    !(specialLink?.valid && specialLink?.bypassCapacity) &&
    event.enableWaitlist === 1 &&
    event.confirmedCount + groupSize > event.capacity;

  if (loading) {
    return (
      <PublicLayout>
        <div className="max-w-2xl mx-auto px-4 py-16 text-center text-gray-500">Loading...</div>
      </PublicLayout>
    );
  }

  if (loadError || !event) {
    return (
      <PublicLayout>
        <SeoMeta title="Event Not Found" />
        <div className="max-w-2xl mx-auto px-4 py-16 text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Event Not Found</h1>
          <Link to="/events" className="text-primary-teal hover:underline">Back to events</Link>
        </div>
      </PublicLayout>
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
          <Link to={`/events/${slug}`} className="text-sm text-primary-teal hover:underline mb-6 inline-block">
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
          <Link to={`/events/${slug}`} className="text-sm text-primary-teal hover:underline mb-6 inline-block">
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

  const effectiveMaxGroupSize = specialLink?.valid && specialLink?.maxGroupSize != null
    ? (event.maxGroupSize != null ? Math.min(event.maxGroupSize, specialLink.maxGroupSize) : specialLink.maxGroupSize)
    : event.maxGroupSize;

  const addGroupMember = () => setGroupMembers([...groupMembers, { name: '', email: '' }]);
  const removeGroupMember = (i: number) => setGroupMembers(groupMembers.filter((_, idx) => idx !== i));
  const updateGroupMember = (i: number, field: keyof GroupMember, value: string) => {
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
        contactName: contactName.trim(),
        contactEmail: contactEmail.trim(),
        groupMembers: groupMembers.length > 0
          ? groupMembers.map((m) => ({ name: m.name.trim(), email: m.email.trim() || undefined }))
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
            <Link to={`/events/${slug}`} className="mt-6 inline-block text-primary-teal hover:underline">
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
      <div className="max-w-2xl mx-auto px-4 py-10">
        <Link to={`/events/${slug}`} className="text-sm text-primary-teal hover:underline mb-6 inline-block">
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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Your Name *</label>
            <input
              type="text"
              required
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              className={publicInput}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email Address *</label>
            <input
              type="email"
              required
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              className={publicInput}
            />
          </div>

          {event.allowGroupRegistration === 1 && (
            <div className="border border-gray-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-gray-900">Group Members</h3>
                <button
                  type="button"
                  onClick={addGroupMember}
                  disabled={effectiveMaxGroupSize ? groupSize >= effectiveMaxGroupSize : false}
                  className="text-sm text-primary-teal hover:underline disabled:opacity-50"
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
                      <RegistrationFieldInput
                        field={field}
                        fieldGroupKey={fieldValueKey(field.id, field.scope, personIndex)}
                        value={fieldValues[fieldValueKey(field.id, field.scope, personIndex)] || ''}
                        onChange={(v) => setVal(fieldValueKey(field.id, field.scope, personIndex), v)}
                      />
                    </div>
                  ))}
                </div>
              );
            }

            return (
              <RegistrationFieldInput
                key={field.id}
                field={field}
                fieldGroupKey={fieldValueKey(field.id, field.scope, 0)}
                value={fieldValues[fieldValueKey(field.id, field.scope, 0)] || ''}
                onChange={(v) => setVal(fieldValueKey(field.id, field.scope, 0), v)}
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
                  className="text-primary-teal hover:underline"
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
            className="w-full py-3 bg-primary-teal text-white font-medium rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50 tabular-nums"
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

function RegistrationFieldInput({
  field,
  fieldGroupKey,
  value,
  onChange,
}: {
  field: EventField;
  fieldGroupKey?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const gk = fieldGroupKey ?? String(field.id);
  switch (field.field_type) {
    case 'preset_phone':
      return (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {field.label} {field.required === 1 && '*'}
          </label>
          <input
            type="tel"
            autoComplete="tel"
            required={field.required === 1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={publicInput}
            placeholder="Phone number"
          />
        </div>
      );
    case 'preset_dob':
      return (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {field.label} {field.required === 1 && '*'}
          </label>
          <input
            type="date"
            required={field.required === 1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={publicInput}
          />
        </div>
      );
    case 'preset_address':
      return <PresetAddressField field={field} value={value} onChange={onChange} />;
    case 'preset_team_four':
      return (
        <TeamPlayersField
          label={field.label}
          required={field.required === 1}
          value={value || defaultTeamPlayersJson(4)}
          onChange={onChange}
          positions={TEAM_POSITIONS_FOUR}
          inputClassName={publicInput}
          lightOnly
        />
      );
    case 'preset_team_doubles':
      return (
        <TeamPlayersField
          label={field.label}
          required={field.required === 1}
          value={value || defaultTeamPlayersJson(2)}
          onChange={onChange}
          positions={TEAM_POSITIONS_DOUBLES}
          inputClassName={publicInput}
          lightOnly
        />
      );
    default:
      return <LegacyRegistrationField field={field} radioGroupName={gk} value={value} onChange={onChange} />;
  }
}

function PresetAddressField({
  field,
  value,
  onChange,
}: {
  field: EventField;
  value: string;
  onChange: (value: string) => void;
}) {
  let parsed: { street?: string; city?: string; state?: string; postalCode?: string; country?: string };
  try {
    const o = value ? JSON.parse(value) : {};
    parsed =
      typeof o === 'object' && o !== null
        ? (o as typeof parsed)
        : { street: '', city: '', state: '', postalCode: '', country: '' };
  } catch {
    parsed = { street: '', city: '', state: '', postalCode: '', country: '' };
  }

  const setPart = (key: keyof typeof parsed, v: string) => {
    onChange(JSON.stringify({ ...parsed, [key]: v }));
  };

  const streetVal = parsed.street ?? '';
  /** Avoid Nominatim calls for prefilled addresses until the user edits street. */
  const [streetDirty, setStreetDirty] = useState(false);
  const [streetFocused, setStreetFocused] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{ label: string; json: string }>>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addressLookupSeqRef = useRef(0);
  const addressFetchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    addressFetchAbortRef.current?.abort();
    const seq = ++addressLookupSeqRef.current;
    if (!streetDirty) {
      setSuggestions([]);
      setLookupLoading(false);
      return;
    }
    const q = streetVal.trim();
    if (q.length === 0) {
      setSuggestions([]);
      setLookupLoading(false);
      return;
    }
    if (q.length < 3) {
      debounceRef.current = setTimeout(() => {
        if (seq !== addressLookupSeqRef.current) return;
        setLookupLoading(false);
        setSuggestions([]);
      }, 450);
      return () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
    }
    debounceRef.current = setTimeout(() => {
      if (seq !== addressLookupSeqRef.current) return;
      const ac = new AbortController();
      addressFetchAbortRef.current = ac;
      void (async () => {
        try {
          setLookupLoading(true);
          const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&addressdetails=1&limit=5`;
          const res = await fetch(url, {
            signal: ac.signal,
            headers: {
              Accept: 'application/json',
              'User-Agent': 'TriangleCurlingSpares/1.0 (event registration)',
            },
          });
          const data = (await res.json()) as Array<{
            display_name?: string;
            address?: Record<string, string>;
          }>;
          if (seq !== addressLookupSeqRef.current) return;
          const mapped = data.map((item) => {
            const a = item.address ?? {};
            const street = [a.house_number, a.road].filter(Boolean).join(' ').trim() || a.road || '';
            const city = a.city || a.town || a.village || a.hamlet || '';
            const state = a.state || '';
            const postalCode = a.postcode || '';
            const country = a.country || '';
            const json = JSON.stringify({ street, city, state, postalCode, country });
            return { label: item.display_name || street || city, json };
          });
          setSuggestions(mapped);
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return;
          if (seq !== addressLookupSeqRef.current) return;
          setSuggestions([]);
        } finally {
          if (seq === addressLookupSeqRef.current) setLookupLoading(false);
        }
      })();
    }, 450);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [streetVal, streetDirty]);

  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const activeSuggestionIndexRef = useRef(-1);
  activeSuggestionIndexRef.current = activeSuggestionIndex;

  useEffect(() => {
    setActiveSuggestionIndex(-1);
  }, [suggestions, lookupLoading]);

  const idPrefix = `reg-addr-${field.id}`;
  const trimmedStreet = streetVal.trim();
  const showStreetDropdown =
    streetFocused && streetDirty && trimmedStreet.length > 0;

  const applyStreetSuggestion = (s: { label: string; json: string }) => {
    setStreetDirty(false);
    setLookupLoading(false);
    onChange(s.json);
    setSuggestions([]);
    setStreetFocused(false);
    setActiveSuggestionIndex(-1);
  };

  useEffect(() => {
    if (activeSuggestionIndex < 0 || !showStreetDropdown) return;
    document.getElementById(`${idPrefix}-suggest-${activeSuggestionIndex}`)?.scrollIntoView({
      block: 'nearest',
    });
  }, [activeSuggestionIndex, idPrefix, showStreetDropdown]);

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-gray-800 mb-1">
        {field.label} {field.required === 1 && '*'}
      </legend>
      <div>
        <label htmlFor={`${idPrefix}-street`} className="block text-sm font-medium text-gray-700 mb-1">
          Street {field.required === 1 && '*'}
        </label>
        <div className="relative">
          <input
            id={`${idPrefix}-street`}
            type="text"
            required={field.required === 1}
            value={streetVal}
            onChange={(e) => {
              const v = e.target.value;
              setStreetDirty(true);
              setPart('street', v);
              if (v.trim().length >= 1) setLookupLoading(true);
            }}
            onFocus={() => setStreetFocused(true)}
            onBlur={() => {
              window.setTimeout(() => setStreetFocused(false), 150);
            }}
            onKeyDown={(e) => {
              if (!showStreetDropdown || lookupLoading || suggestions.length === 0) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveSuggestionIndex((i) => {
                  const n = i < 0 ? 0 : Math.min(i + 1, suggestions.length - 1);
                  activeSuggestionIndexRef.current = n;
                  return n;
                });
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveSuggestionIndex((i) => {
                  const n = i <= 0 ? -1 : i - 1;
                  activeSuggestionIndexRef.current = n;
                  return n;
                });
              } else if (e.key === 'Enter') {
                const idx = activeSuggestionIndexRef.current;
                const s = idx >= 0 ? suggestions[idx] : undefined;
                if (s) {
                  e.preventDefault();
                  applyStreetSuggestion(s);
                }
              }
            }}
            className={publicInput}
            autoComplete="off"
            placeholder="Street"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showStreetDropdown && suggestions.length > 0}
            aria-controls={`${idPrefix}-street-listbox`}
            aria-activedescendant={
              activeSuggestionIndex >= 0 ? `${idPrefix}-suggest-${activeSuggestionIndex}` : undefined
            }
          />
          {showStreetDropdown && (
            <ul
              id={`${idPrefix}-street-listbox`}
              role="listbox"
              className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg text-sm"
            >
              {lookupLoading ? (
                <li className="px-3 py-2 text-gray-500">Loading...</li>
              ) : suggestions.length > 0 ? (
                suggestions.map((s, i) => (
                  <li key={i} role="presentation">
                    <button
                      id={`${idPrefix}-suggest-${i}`}
                      type="button"
                      role="option"
                      aria-selected={activeSuggestionIndex === i}
                      className={`w-full px-3 py-2 text-left ${
                        activeSuggestionIndex === i ? 'bg-gray-100' : 'hover:bg-gray-50'
                      }`}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => {
                        activeSuggestionIndexRef.current = i;
                        setActiveSuggestionIndex(i);
                      }}
                      onClick={() => applyStreetSuggestion(s)}
                    >
                      {s.label}
                    </button>
                  </li>
                ))
              ) : trimmedStreet.length >= 3 ? (
                <li className="px-3 py-2 text-gray-500">No results</li>
              ) : (
                <li className="px-3 py-2 text-gray-500">Keep typing to search.</li>
              )}
            </ul>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label htmlFor={`${idPrefix}-city`} className="block text-sm font-medium text-gray-700 mb-1">
            City {field.required === 1 && '*'}
          </label>
          <input
            id={`${idPrefix}-city`}
            type="text"
            required={field.required === 1}
            value={parsed.city ?? ''}
            onChange={(e) => setPart('city', e.target.value)}
            className={publicInput}
            placeholder="City"
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-state`} className="block text-sm font-medium text-gray-700 mb-1">
            State / province
          </label>
          <input
            id={`${idPrefix}-state`}
            type="text"
            value={parsed.state ?? ''}
            onChange={(e) => setPart('state', e.target.value)}
            className={publicInput}
            placeholder="State / province"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label htmlFor={`${idPrefix}-postal`} className="block text-sm font-medium text-gray-700 mb-1">
            Postal code
          </label>
          <input
            id={`${idPrefix}-postal`}
            type="text"
            value={parsed.postalCode ?? ''}
            onChange={(e) => setPart('postalCode', e.target.value)}
            className={publicInput}
            placeholder="Postal code"
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-country`} className="block text-sm font-medium text-gray-700 mb-1">
            Country
          </label>
          <input
            id={`${idPrefix}-country`}
            type="text"
            value={parsed.country ?? ''}
            onChange={(e) => setPart('country', e.target.value)}
            className={publicInput}
            placeholder="Country"
          />
        </div>
      </div>
    </fieldset>
  );
}

function LegacyRegistrationField({
  field,
  radioGroupName,
  value,
  onChange,
}: {
  field: EventField;
  radioGroupName: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const options = field.options ? field.options.split(',').map((o) => o.trim()).filter(Boolean) : [];

  switch (field.field_type) {
    case 'checkbox':
      return (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={value === '1' || value === 'true'}
            onChange={(e) => onChange(e.target.checked ? '1' : '0')}
          />
          <span className="text-sm text-gray-700">
            {field.label} {field.required === 1 && '*'}
          </span>
        </label>
      );

    case 'dropdown':
      return (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {field.label} {field.required === 1 && '*'}
          </label>
          <select
            required={field.required === 1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={publicInput}
          >
            <option value="">Select...</option>
            {options.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      );

    case 'radio':
      return (
        <fieldset>
          <legend className="text-sm font-medium text-gray-700 mb-2">
            {field.label} {field.required === 1 && '*'}
          </legend>
          <div className="space-y-1">
            {options.map((opt) => (
              <label key={opt} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name={`field-${radioGroupName}`}
                  value={opt}
                  checked={value === opt}
                  onChange={() => onChange(opt)}
                  required={field.required === 1}
                />
                <span className="text-sm text-gray-700">{opt}</span>
              </label>
            ))}
          </div>
        </fieldset>
      );

    case 'number':
      return (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {field.label} {field.required === 1 && '*'}
          </label>
          <input
            type="number"
            required={field.required === 1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={publicInput}
          />
        </div>
      );

    default:
      return (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {field.label} {field.required === 1 && '*'}
          </label>
          <input
            type="text"
            required={field.required === 1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={publicInput}
          />
        </div>
      );
  }
}
