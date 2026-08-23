import { useId, type ReactNode } from 'react';
import type { FormFieldTone } from '../FormFieldMessage';
import FormSection from '../FormSection';
import HelpCallout from '../HelpCallout';

const USA_CURLING_HELP = (
  <>
    USA Curling is the national governing body (NGB) for the sport of curling in the United States. USA Curling
    membership provides access to national competitions, clinics, courses, and SafeSport training. For more info, see{' '}
    <a
      href="https://usacurling.org/membership"
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary-teal underline"
    >
      https://usacurling.org/membership
    </a>
  </>
);

const GNCC_HELP =
  'The Grand National Curling Club of America (GNCC) is the regional curling association to which Triangle Curling belongs. The GNCC organizes competitions, provides support for curling clubs, and provides SafeSport training for those who are not USA Curling members.';

const USWCA_HELP =
  "The United States Women's Curling Association supports women's curling in the US by organizing annual women's bonspiels, supporting junior curling, providing grants for developmental curling, and acting as a voice to USA Curling. Membership is open to all.";

type RegistrationParentAssociationFieldsProps = {
  usaCurlingOptIn: boolean;
  uswcaOptIn: boolean;
  onUsaCurlingChange: (checked: boolean) => void;
  onUswcaChange: (checked: boolean) => void;
  tone?: FormFieldTone;
};

function OrgMention({
  name,
  help,
  helpLabel,
}: {
  name: string;
  help: ReactNode;
  helpLabel: string;
}) {
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="whitespace-nowrap">{name}</span>
      <HelpCallout text={help} label={helpLabel} />
    </span>
  );
}

function MembershipOptInToggle({
  organization,
  checked,
  onChange,
  tone,
}: {
  organization: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  tone: FormFieldTone;
}) {
  const id = useId();

  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={[
          'relative mt-0.5 inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-primary-teal focus:ring-offset-2',
          tone === 'app' ? 'dark:focus:ring-offset-gray-800' : null,
          checked ? 'bg-primary-teal' : tone === 'app' ? 'bg-gray-200 dark:bg-gray-600' : 'bg-gray-200',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <span
          className={[
            'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition',
            checked ? 'translate-x-5' : 'translate-x-1',
          ].join(' ')}
          aria-hidden
        />
      </button>
      <label
        htmlFor={id}
        className={
          tone === 'app'
            ? 'cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300'
            : 'cursor-pointer text-sm font-medium text-gray-700'
        }
      >
        I {checked ? <strong>want</strong> : <strong>do not want</strong>} to be a member of {organization}
      </label>
    </div>
  );
}

export default function RegistrationParentAssociationFields({
  usaCurlingOptIn,
  uswcaOptIn,
  onUsaCurlingChange,
  onUswcaChange,
  tone = 'public',
}: RegistrationParentAssociationFieldsProps) {
  return (
    <FormSection title="Parent association memberships" tone={tone}>
      <div
        className={
          tone === 'app'
            ? 'text-sm leading-relaxed text-gray-600 dark:text-gray-400'
            : 'text-sm leading-relaxed text-gray-600'
        }
      >
        Your Triangle Curling membership includes a membership to{' '}
        <OrgMention name="USA Curling" help={USA_CURLING_HELP} helpLabel="About USA Curling" />, the{' '}
        <OrgMention name="GNCC" help={GNCC_HELP} helpLabel="About the GNCC" />, and{' '}
        <OrgMention name="USWCA" help={USWCA_HELP} helpLabel="About the USWCA" />. You may opt-out of USA Curling
        and/or USWCA membership by <strong>turning off</strong> the toggles below. Because Triangle Curling&apos;s
        liability insurance policy is provided through the GNCC, opting out of GNCC membership is not offered.{' '}
        <strong>Your selections here will not affect your dues.</strong>
      </div>
      <div className="space-y-3">
        <MembershipOptInToggle
          organization="USA Curling"
          checked={usaCurlingOptIn}
          onChange={onUsaCurlingChange}
          tone={tone}
        />
        <MembershipOptInToggle
          organization="US Women's Curling Association"
          checked={uswcaOptIn}
          onChange={onUswcaChange}
          tone={tone}
        />
      </div>
    </FormSection>
  );
}
