import { useEffect, useMemo, useState } from 'react';
import type { ChoiceOption } from './ChoiceInput';
import ChoiceInput from './ChoiceInput';
import FormField from './FormField';
import {
  PREFERRED_PRONOUN_MAX_LENGTH,
  PREFERRED_PRONOUN_OTHER_LABEL,
  PREFERRED_PRONOUN_OTHER_VALUE,
  PREFERRED_PRONOUN_PRESET_VALUES,
  isPreferredPronounPreset,
  sanitizePreferredPronounsInput,
} from '../utils/preferredPronouns';

type PreferredPronounsFieldProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  tone?: 'public' | 'app';
  className?: string;
};

export default function PreferredPronounsField({
  id,
  value,
  onChange,
  tone = 'app',
  className,
}: PreferredPronounsFieldProps) {
  const [query, setQuery] = useState(value);
  const [typingCustom, setTypingCustom] = useState(
    () => Boolean(value) && !isPreferredPronounPreset(value),
  );

  useEffect(() => {
    setQuery(value);
    if (value) {
      setTypingCustom(!isPreferredPronounPreset(value));
    }
  }, [value]);

  const options = useMemo<ChoiceOption<string>[]>(
    () => [
      ...PREFERRED_PRONOUN_PRESET_VALUES.filter((preset) => preset !== 'Prefer not to say').map(
        (preset) => ({ value: preset, label: preset }),
      ),
      {
        value: PREFERRED_PRONOUN_OTHER_VALUE,
        label: PREFERRED_PRONOUN_OTHER_LABEL,
        action: ({ close }) => {
          setTypingCustom(true);
          setQuery('');
          onChange('');
          close();
          requestAnimationFrame(() => {
            document.getElementById(id)?.focus();
          });
        },
      },
      { value: 'Prefer not to say', label: 'Prefer not to say' },
    ],
    [id, onChange],
  );

  return (
    <FormField label="Preferred pronouns" htmlFor={id} optional tone={tone} className={className}>
      <ChoiceInput
        inputId={id}
        layout="popover"
        options={options}
        value={value || null}
        onChange={(next) => {
          if (next === PREFERRED_PRONOUN_OTHER_VALUE) return;
          const stored = typeof next === 'string' ? sanitizePreferredPronounsInput(next) : '';
          setTypingCustom(Boolean(stored) && !isPreferredPronounPreset(stored));
          setQuery(stored);
          onChange(stored);
        }}
        inputValue={query}
        onInputValueChange={(next) => {
          if (next === PREFERRED_PRONOUN_OTHER_LABEL || next === PREFERRED_PRONOUN_OTHER_VALUE) {
            setQuery('');
            setTypingCustom(true);
            onChange('');
            return;
          }
          const display = next.slice(0, PREFERRED_PRONOUN_MAX_LENGTH);
          setQuery(display);
          setTypingCustom(Boolean(display.trim()) && !isPreferredPronounPreset(display.trim()));
          onChange(display);
        }}
        allowCustomValue
        createCustomValue={(raw) => sanitizePreferredPronounsInput(raw) || null}
        placeholder={typingCustom ? 'Type your pronouns' : 'Select pronouns'}
        listboxLabel="Preferred pronouns"
      />
    </FormField>
  );
}
