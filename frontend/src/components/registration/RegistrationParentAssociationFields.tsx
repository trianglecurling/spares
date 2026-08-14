import { useId, type ReactNode } from 'react';
import FormCheckbox from '../FormCheckbox';
import FormField from '../FormField';
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

export default function RegistrationParentAssociationFields({
  usaCurlingOptIn,
  uswcaOptIn,
  onUsaCurlingChange,
  onUswcaChange,
}: RegistrationParentAssociationFieldsProps) {
  const optOutLabelId = useId();

  return (
    <FormSection title="Parent association memberships" tone="public">
      <div className="text-sm leading-relaxed text-gray-600">
        Your Triangle Curling membership includes a membership to{' '}
        <OrgMention name="USA Curling" help={USA_CURLING_HELP} helpLabel="About USA Curling" />, the{' '}
        <OrgMention name="GNCC" help={GNCC_HELP} helpLabel="About the GNCC" />, and{' '}
        <OrgMention name="USWCA" help={USWCA_HELP} helpLabel="About the USWCA" />. You may opt-out of USA Curling
        and/or USWCA membership by <strong>unchecking</strong> the checkbox below. Because Triangle Curling&apos;s
        liability insurance policy is provided through the GNCC, opting out of GNCC membership is not offered.{' '}
        <strong>Your selections here will not affect your dues.</strong>
      </div>
      <FormField
        label={
          <>
            To opt out of a parent organization, <strong>uncheck</strong> the box below.
          </>
        }
        labelId={optOutLabelId}
        tone="public"
      >
        <div role="group" aria-labelledby={optOutLabelId} className="space-y-3">
          <FormCheckbox
            tone="public"
            label="USA Curling"
            checked={usaCurlingOptIn}
            onChange={onUsaCurlingChange}
          />
          <FormCheckbox
            tone="public"
            label="US Women's Curling Association"
            checked={uswcaOptIn}
            onChange={onUswcaChange}
          />
        </div>
      </FormField>
    </FormSection>
  );
}
