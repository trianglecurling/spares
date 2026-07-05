import { FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import FormField from '../FormField';
import { useAuth } from '../../contexts/AuthContext';
import PublicRegistrationFieldInput, {
  publicEventRegistrationInput,
  fieldValueKey,
  personLabel,
  type EventRegistrationField,
} from './PublicRegistrationFieldInput';
import {
  defaultTeamNameFromLastName,
  isSubheadingFieldType,
  lastNameFromDisplayName,
} from '../../utils/eventRegistrationFieldPresets';

const publicInput = publicEventRegistrationInput;

export type EventRegistrationFormEvent = {
  title: string;
  feeMinor: number;
  memberFeeMinor?: number | null;
  yourFeeMinor?: number | null;
  currency: string;
  allowGroupRegistration: number;
  maxGroupSize: number | null;
  termsArticleId?: number | null;
  registrationFields: EventRegistrationField[];
};

interface GroupMember {
  name: string;
  email: string;
}

export type EventRegistrationFormContentProps = {
  event: EventRegistrationFormEvent;
  slug?: string;
  preview?: boolean;
  submitting?: boolean;
  submitError?: string | null;
  onSubmit?: (e: FormEvent) => void;
  registerButtonLabel?: string;
  registerButtonDisabled?: boolean;
  registeringAsWaitlist?: boolean;
  prefillBanner?: ReactNode;
  feeLine?: ReactNode;
  showBackLink?: boolean;
};

function formatFee(feeMinor: number, currency: string): string {
  if (feeMinor <= 0) return 'Free';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'usd',
  }).format(feeMinor / 100);
}

export default function EventRegistrationFormContent({
  event,
  slug,
  preview = false,
  submitting = false,
  submitError = null,
  onSubmit,
  registerButtonLabel,
  registerButtonDisabled = false,
  registeringAsWaitlist = false,
  prefillBanner,
  feeLine,
  showBackLink = true,
}: EventRegistrationFormContentProps) {
  const { member } = useAuth();

  const [contactFirstName, setContactFirstName] = useState('');
  const [contactLastName, setContactLastName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const teamNameTouchedRef = useRef<Set<string>>(new Set());
  const [acceptTerms, setAcceptTerms] = useState(false);
  const contactFirstNameFieldId = useId();
  const contactLastNameFieldId = useId();
  const contactEmailFieldId = useId();

  const totalPeople = 1 + groupMembers.length;
  const groupSize = groupMembers.length + 1;

  const effectiveFee =
    event.yourFeeMinor != null ? event.yourFeeMinor : event.feeMinor;
  const totalFee = effectiveFee * groupSize;
  const effectiveMaxGroupSize = event.maxGroupSize;

  useEffect(() => {
    if (preview || !member) return;
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
  }, [event, groupMembers.length, member, preview]);

  const setVal = useCallback((key: string, v: string) => {
    setFieldValues((prev) => ({ ...prev, [key]: v }));
  }, []);

  const setFieldVal = useCallback(
    (field: EventRegistrationField, personIndex: number, v: string, userEdited = true) => {
      const key = fieldValueKey(field.id, field.scope, personIndex);
      if (field.field_type === 'preset_team_name' && userEdited) {
        teamNameTouchedRef.current.add(key);
      }
      setVal(key, v);
    },
    [setVal],
  );

  useEffect(() => {
    const nextFields = event.registrationFields;
    const total = 1 + groupMembers.length;
    setFieldValues((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const field of nextFields) {
        if (field.field_type !== 'preset_team_name') continue;
        if (field.scope === 'individual') {
          for (let personIndex = 0; personIndex < total; personIndex += 1) {
            const key = fieldValueKey(field.id, field.scope, personIndex);
            if (teamNameTouchedRef.current.has(key)) continue;
            const personLastName =
              personIndex === 0
                ? contactLastName
                : lastNameFromDisplayName(groupMembers[personIndex - 1]?.name ?? '');
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
  }, [event.registrationFields, contactLastName, groupMembers]);

  const sortedFields = useMemo(() => {
    return [...event.registrationFields].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }, [event.registrationFields]);

  const addGroupMember = () => setGroupMembers([...groupMembers, { name: '', email: '' }]);
  const removeGroupMember = (i: number) => setGroupMembers(groupMembers.filter((_, idx) => idx !== i));
  const updateGroupMember = (i: number, field: keyof GroupMember, value: string) => {
    const updated = [...groupMembers];
    updated[i] = { ...updated[i], [field]: value };
    setGroupMembers(updated);
  };

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (preview) return;
    onSubmit?.(e);
  };

  const defaultFeeLine = registeringAsWaitlist ? (
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
        event.yourFeeMinor < event.feeMinor && (
          <span className="block text-sm mt-1 text-gray-500">
            Logged-in member rate applies (otherwise {formatFee(event.feeMinor * groupSize, event.currency)}
            {groupSize > 1 ? ` total, ${formatFee(event.feeMinor, event.currency)} per person` : ''}).
          </span>
        )}
    </p>
  );

  const submitLabel =
    registerButtonLabel ??
    (registeringAsWaitlist
      ? 'Join waitlist'
      : totalFee > 0
        ? `Register & Pay ${formatFee(totalFee, event.currency)}`
        : 'Register');

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      {showBackLink && slug ? (
        <Link to={`/events/${slug}`} className="text-sm text-primary-teal-link hover:underline mb-6 inline-block">
          &larr; Back to event
        </Link>
      ) : null}

      {prefillBanner}

      <h1 className="text-2xl font-bold text-gray-900 mb-2">
        {registeringAsWaitlist ? `Join waitlist for ${event.title}` : `Register for ${event.title}`}
      </h1>

      {feeLine ?? defaultFeeLine}

      {submitError ? (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6">{submitError}</div>
      ) : null}

      <form onSubmit={handleFormSubmit} className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField tone="public" label="First name" htmlFor={contactFirstNameFieldId} required>
            <input
              id={contactFirstNameFieldId}
              type="text"
              autoComplete="given-name"
              required={!preview}
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
              required={!preview}
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
            required={!preview}
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            className={publicInput}
          />
        </FormField>

        {event.allowGroupRegistration === 1 && (
          <div className="border border-gray-200 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-gray-900">Group Members</h3>
              <button
                type="button"
                onClick={addGroupMember}
                disabled={effectiveMaxGroupSize ? groupSize >= effectiveMaxGroupSize : false}
                className="text-sm text-primary-teal-link hover:underline disabled:opacity-50"
              >
                + Add member
              </button>
            </div>
            {groupMembers.map((groupMember, i) => (
              <div key={i} className="flex gap-2 items-start">
                <input
                  type="text"
                  placeholder="Name"
                  required={!preview}
                  value={groupMember.name}
                  onChange={(e) => updateGroupMember(i, 'name', e.target.value)}
                  className={`${publicInput} flex-1`}
                />
                <input
                  type="email"
                  placeholder="Email (optional)"
                  value={groupMember.email}
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

        {event.termsArticleId ? (
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={acceptTerms}
              onChange={(e) => setAcceptTerms(e.target.checked)}
              className="mt-1"
              required={!preview}
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
        ) : null}

        <button
          type="submit"
          disabled={
            preview ||
            submitting ||
            registerButtonDisabled ||
            (!!event.termsArticleId && !acceptTerms)
          }
          aria-disabled={preview || undefined}
          title={preview ? 'Registration is disabled in preview mode' : undefined}
          className="w-full py-3 bg-primary-teal-solid text-white font-medium rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50 tabular-nums"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {preview ? submitLabel : submitting ? 'Processing...' : submitLabel}
        </button>
      </form>
    </div>
  );
}
