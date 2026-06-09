import { memo, useRef, type FormEvent } from 'react';
import Button from '../Button';
import RegistrationDemographicFields, {
  type RegistrationDemographicFieldsHandle,
  type RegistrationDemographicsFormFields,
} from './RegistrationDemographicFields';
import RegistrationFlowHeaderBar from './RegistrationFlowHeaderBar';

type RegistrationDemographicsStepProps = {
  registrationId: number | null;
  initialDemographics: RegistrationDemographicsFormFields;
  returningDemographics: boolean;
  headerTitle: string;
  showStartOver: boolean;
  loading: boolean;
  error: string;
  backLabel: string;
  onBack: () => void;
  onStartOver: () => void;
  onCommitDraft: (form: RegistrationDemographicsFormFields) => void;
  onSubmit: (form: RegistrationDemographicsFormFields) => void;
};

function RegistrationDemographicsStep({
  registrationId,
  initialDemographics,
  returningDemographics,
  headerTitle,
  showStartOver,
  loading,
  error,
  backLabel,
  onBack,
  onStartOver,
  onCommitDraft,
  onSubmit,
}: RegistrationDemographicsStepProps) {
  const fieldsRef = useRef<RegistrationDemographicFieldsHandle>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = fieldsRef.current?.getValue() ?? initialDemographics;
    onSubmit(form);
  }

  return (
    <div className="mx-auto max-w-3xl rounded-3xl border border-emerald-100 bg-white/95 p-6 shadow-xl shadow-emerald-950/10 sm:p-8">
      <RegistrationFlowHeaderBar
        backLabel={backLabel}
        onBack={onBack}
        headerTitle={headerTitle}
        showStartOver={showStartOver}
        loading={loading}
        onStartOver={onStartOver}
      />
      <h1 className="text-3xl font-bold text-[#121033]">Curler demographics</h1>
      <p className="mt-3 text-gray-600">
        {returningDemographics
          ? 'Review the curler\u2019s information and update anything that has changed.'
          : 'Enter information for the person being registered.'}
      </p>
      <form onSubmit={handleSubmit} className="mt-6 space-y-6">
        <RegistrationDemographicFields
          key={`${registrationId ?? 'guest'}-demographics`}
          ref={fieldsRef}
          initialValue={initialDemographics}
          onCommit={onCommitDraft}
        />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <Button type="submit" disabled={loading}>
          Save and continue
        </Button>
      </form>
    </div>
  );
}

export default memo(RegistrationDemographicsStep);
