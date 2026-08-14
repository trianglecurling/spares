import { useEffect, useState } from 'react';
import ChoiceInput from './ChoiceInput';
import FormField from './FormField';
import HelpCallout from './HelpCallout';
import {
  USA_CURLING_COMPETITION_GENDER_DEFAULT,
  USA_CURLING_COMPETITION_GENDER_HELP,
  USA_CURLING_COMPETITION_GENDER_OPTIONS,
  resolveUsaCurlingCompetitionGenderForSave,
  type UsaCurlingCompetitionGender,
} from '../utils/usaCurlingCompetitionGender';

type UsaCurlingCompetitionGenderFieldProps = {
  id: string;
  value: string;
  onChange: (value: UsaCurlingCompetitionGender) => void;
  tone?: 'public' | 'app';
  className?: string;
  /** Admin editors always show the dropdown instead of the specify link. */
  alwaysShowSelect?: boolean;
};

const helpCallout = (
  <HelpCallout
    text={USA_CURLING_COMPETITION_GENDER_HELP}
    label="About USA Curling competition gender"
  />
);

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export default function UsaCurlingCompetitionGenderField({
  id,
  value,
  onChange,
  tone = 'app',
  className,
  alwaysShowSelect = false,
}: UsaCurlingCompetitionGenderFieldProps) {
  const resolved = resolveUsaCurlingCompetitionGenderForSave(value);
  const [expanded, setExpanded] = useState(
    alwaysShowSelect || resolved === 'Male' || resolved === 'Female',
  );
  const showSelect = alwaysShowSelect || expanded;

  useEffect(() => {
    if (alwaysShowSelect || resolved === 'Male' || resolved === 'Female') {
      setExpanded(true);
    }
  }, [alwaysShowSelect, resolved]);

  if (!showSelect) {
    return (
      <div className={joinClasses('flex h-full flex-col space-y-1.5', className)}>
        <div
          className="invisible mb-1 flex flex-wrap items-center gap-x-2 gap-y-1"
          aria-hidden="true"
        >
          <span className="text-sm font-medium">Preferred pronouns</span>
          <span className="text-xs font-medium">Optional</span>
        </div>
        <div className="flex flex-1 items-center justify-center gap-1.5">
          <button
            type="button"
            className="text-sm font-medium text-primary-teal-link hover:underline"
            onClick={() => {
              setExpanded(true);
              onChange(USA_CURLING_COMPETITION_GENDER_DEFAULT);
            }}
          >
            Specify USA Curling competition gender
          </button>
          {helpCallout}
        </div>
      </div>
    );
  }

  return (
    <FormField
      label="USA Curling competition gender"
      htmlFor={id}
      optional
      tone={tone}
      className={className}
      labelAccessory={helpCallout}
    >
      <ChoiceInput
        inputId={id}
        layout="popover"
        options={USA_CURLING_COMPETITION_GENDER_OPTIONS}
        value={resolved}
        onChange={(next) => onChange(resolveUsaCurlingCompetitionGenderForSave(typeof next === 'string' ? next : ''))}
        placeholder="Select competition gender"
        listboxLabel="USA Curling competition gender"
      />
    </FormField>
  );
}
