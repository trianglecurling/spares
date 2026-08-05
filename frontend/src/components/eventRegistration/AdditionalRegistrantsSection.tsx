import { useId } from 'react';
import FormField from '../FormField';
import { personLabel, publicEventRegistrationInput } from './PublicRegistrationFieldInput';

const publicInput = publicEventRegistrationInput;

export type AdditionalRegistrant = {
  firstName: string;
  lastName: string;
  email: string;
};

export type AdditionalRegistrantFieldLabels = {
  firstName: string;
  lastName: string;
  email: string;
};

export function emptyAdditionalRegistrant(): AdditionalRegistrant {
  return { firstName: '', lastName: '', email: '' };
}

function formatPerPersonFee(feeMinor: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'usd',
  }).format(feeMinor / 100);
}

type AdditionalRegistrantsSectionProps = {
  members: AdditionalRegistrant[];
  labels: AdditionalRegistrantFieldLabels;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onChange: (index: number, field: keyof AdditionalRegistrant, value: string) => void;
  /** Total people allowed including the primary registrant. */
  maxGroupSize?: number | null;
  /**
   * Footer copy when the add control is hidden because `maxGroupSize` was reached.
   * Defaults to the maximum group size message.
   */
  limitMessage?: string | null;
  /** Per-person fee in minor units; shown next to the heading when greater than zero. */
  perPersonFeeMinor?: number | null;
  currency?: string;
  /** When false (preview), HTML required is omitted. */
  requireFields?: boolean;
};

export default function AdditionalRegistrantsSection({
  members,
  labels,
  onAdd,
  onRemove,
  onChange,
  maxGroupSize = null,
  limitMessage = null,
  perPersonFeeMinor = null,
  currency = 'usd',
  requireFields = true,
}: AdditionalRegistrantsSectionProps) {
  const fieldIdPrefix = useId();
  const groupSize = members.length + 1;
  const atMaxGroupSize = maxGroupSize != null && groupSize >= maxGroupSize;
  const reachedLimitMessage =
    limitMessage?.trim() ||
    (maxGroupSize != null ? `You have reached the maximum group size (${maxGroupSize})` : null);
  const showPerPersonFee = perPersonFeeMinor != null && perPersonFeeMinor > 0;

  return (
    <div className="border border-gray-200 rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium text-gray-900">
          Additional registrants
          {showPerPersonFee ? (
            <span className="font-normal text-gray-600">
              {' '}
              (+{formatPerPersonFee(perPersonFeeMinor, currency)} each)
            </span>
          ) : null}
        </h3>
        {!atMaxGroupSize ? (
          <button
            type="button"
            onClick={onAdd}
            className="text-sm text-primary-teal-link hover:underline"
          >
            + Add registrant
          </button>
        ) : null}
      </div>

      {members.length === 0 && !atMaxGroupSize ? (
        <p className="text-sm text-gray-500">Register additional attendees for this event</p>
      ) : null}

      {members.map((member, i) => {
        const registrantLabel = personLabel(i + 1);
        const firstNameId = `${fieldIdPrefix}-${i}-firstName`;
        const lastNameId = `${fieldIdPrefix}-${i}-lastName`;
        const emailId = `${fieldIdPrefix}-${i}-email`;

        return (
          <div
            key={i}
            className="space-y-3 rounded-lg border border-gray-100 bg-gray-50/80 p-4"
            role="group"
            aria-label={registrantLabel}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-gray-800">{registrantLabel}</p>
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="text-sm text-red-600 hover:text-red-700"
                aria-label={`Remove ${registrantLabel}`}
              >
                Remove
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField tone="public" label={labels.firstName} htmlFor={firstNameId} required>
                <input
                  id={firstNameId}
                  type="text"
                  autoComplete="off"
                  required={requireFields}
                  value={member.firstName}
                  onChange={(e) => onChange(i, 'firstName', e.target.value)}
                  className={publicInput}
                />
              </FormField>

              <FormField tone="public" label={labels.lastName} htmlFor={lastNameId} required>
                <input
                  id={lastNameId}
                  type="text"
                  autoComplete="off"
                  required={requireFields}
                  value={member.lastName}
                  onChange={(e) => onChange(i, 'lastName', e.target.value)}
                  className={publicInput}
                />
              </FormField>
            </div>

            <FormField tone="public" label={labels.email} htmlFor={emailId} required>
              <input
                id={emailId}
                type="email"
                autoComplete="off"
                required={requireFields}
                value={member.email}
                onChange={(e) => onChange(i, 'email', e.target.value)}
                className={publicInput}
              />
            </FormField>
          </div>
        );
      })}

      {atMaxGroupSize && reachedLimitMessage ? (
        <p className="text-sm text-gray-500">{reachedLimitMessage}</p>
      ) : null}
    </div>
  );
}
