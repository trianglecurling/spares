import { useId, useState } from 'react';
import ChoiceInput, { type ChoiceOption } from '../ChoiceInput';
import FormField from '../FormField';
import type { FormFieldTone } from '../FormFieldMessage';
import {
  DIETARY_RESTRICTION_KEYS,
  DIETARY_RESTRICTION_LABELS,
  dietaryRestrictionsFieldHasSelection,
  parseDietaryRestrictionsFieldValue,
  serializeDietaryRestrictionsFieldValue,
  type DietaryRestrictionKey,
  type DietaryRestrictionsFieldValue,
} from '../../utils/eventRegistrationFieldPresets';

const DIETARY_CHOICE_OPTIONS: ChoiceOption<DietaryRestrictionKey>[] = DIETARY_RESTRICTION_KEYS.map((key) => ({
  value: key,
  label: DIETARY_RESTRICTION_LABELS[key],
}));

export type DietaryRestrictionsFieldProps = {
  label: string;
  required: boolean;
  value: string;
  onChange: (value: string) => void;
  tone?: FormFieldTone;
  /** When false, parent supplies the visible label. */
  showLabel?: boolean;
  /** Public event forms are light-only; omit dark-mode styles so system dark theme does not apply. */
  lightOnly?: boolean;
  name?: string;
};

function flagsFromParsed(parsed: DietaryRestrictionsFieldValue): DietaryRestrictionsFieldValue {
  const next: DietaryRestrictionsFieldValue = {};
  for (const key of DIETARY_RESTRICTION_KEYS) {
    if (parsed[key] === true) next[key] = true;
  }
  return next;
}

export default function DietaryRestrictionsField({
  label,
  required,
  value,
  onChange,
  tone = 'public',
  showLabel = true,
  lightOnly = false,
  name,
}: DietaryRestrictionsFieldProps) {
  const labelId = useId();
  const otherInputId = useId();
  const groupName = name ?? otherInputId;
  const parsed = parseDietaryRestrictionsFieldValue(value);
  const [otherActive, setOtherActive] = useState(() => Boolean(parsed.other?.trim()));
  const [otherDraft, setOtherDraft] = useState(() => parsed.other ?? '');

  const selectedKeys = DIETARY_RESTRICTION_KEYS.filter((key) => parsed[key] === true);
  const hasSatisfyingSelection =
    dietaryRestrictionsFieldHasSelection(parsed) || (otherActive && otherDraft.trim().length > 0);

  const commit = (flags: DietaryRestrictionsFieldValue, otherText: string | null) => {
    const next: DietaryRestrictionsFieldValue = { ...flags };
    const trimmed = otherText?.trim();
    if (trimmed) next.other = trimmed;
    onChange(serializeDietaryRestrictionsFieldValue(next));
  };

  const updateSelection = (nextValue: DietaryRestrictionKey | DietaryRestrictionKey[] | null) => {
    const selected = Array.isArray(nextValue) ? nextValue : nextValue ? [nextValue] : [];
    const flags: DietaryRestrictionsFieldValue = {};
    for (const key of DIETARY_RESTRICTION_KEYS) {
      if (selected.includes(key)) flags[key] = true;
    }
    commit(flags, otherActive ? otherDraft : null);
  };

  const setOtherChecked = (checked: boolean) => {
    setOtherActive(checked);
    if (!checked) {
      setOtherDraft('');
      commit(flagsFromParsed(parsed), null);
      return;
    }
    commit(flagsFromParsed(parsed), otherDraft);
  };

  const setOtherText = (raw: string) => {
    if (!otherActive) setOtherActive(true);
    setOtherDraft(raw);
    commit(flagsFromParsed(parsed), raw);
  };

  const otherRowClass = lightOnly
    ? `flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
        otherActive
          ? 'border-primary-teal/40 bg-primary-teal/5'
          : 'border-gray-200 bg-white hover:border-primary-teal/40 hover:bg-gray-50'
      }`
    : `flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
        otherActive
          ? 'border-primary-teal/40 bg-primary-teal/5 dark:border-primary-teal/50 dark:bg-primary-teal/10'
          : 'border-gray-200 bg-white hover:border-primary-teal/40 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800/70'
      }`;

  const otherLabelClass = lightOnly
    ? 'shrink-0 self-center text-sm font-medium text-gray-900'
    : 'shrink-0 self-center text-sm font-medium text-gray-900 dark:text-gray-100';

  const otherInputClass = lightOnly
    ? 'w-full min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary-teal focus:outline-none focus:ring-2 focus:ring-primary-teal/20'
    : 'app-input min-w-0 flex-1';

  const content = (
    <div className="space-y-3">
      <ChoiceInput<DietaryRestrictionKey>
        options={DIETARY_CHOICE_OPTIONS}
        value={selectedKeys}
        onChange={(nextValue) => updateSelection(nextValue)}
        layout="inline"
        maxSelectedItems={null}
        multiSelectionIndicatorStyle="checkboxes"
        ariaLabelledBy={showLabel ? labelId : undefined}
        ariaLabel={showLabel ? undefined : label}
        name={`${groupName}-dietary`}
      />
      <div className="w-full min-w-0">
        <label className={otherRowClass}>
          <span className="flex h-5 w-4 shrink-0 items-center justify-center self-center">
            <input
              type="checkbox"
              checked={otherActive}
              onChange={(e) => setOtherChecked(e.target.checked)}
              className="h-4 w-4 shrink-0 accent-primary-teal"
              aria-label="Other"
            />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <span className={otherLabelClass}>Other</span>
            <input
              id={otherInputId}
              type="text"
              className={otherInputClass}
              value={otherDraft}
              onChange={(e) => setOtherText(e.target.value)}
              onFocus={() => {
                if (!otherActive) setOtherChecked(true);
              }}
              placeholder="Please specify"
              aria-label="Other, specify"
              autoComplete="off"
            />
          </div>
        </label>
      </div>
      {required && !hasSatisfyingSelection ? (
        <input
          type="text"
          tabIndex={-1}
          aria-hidden
          required
          value=""
          onChange={() => undefined}
          className="sr-only"
        />
      ) : null}
    </div>
  );

  if (!showLabel) {
    return content;
  }

  return (
    <FormField tone={tone} label={label} labelId={labelId} required={required}>
      {content}
    </FormField>
  );
}
