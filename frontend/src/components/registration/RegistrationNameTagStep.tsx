import { useEffect, useId, useState, type FormEvent } from 'react';
import Button from '../Button';
import ChoiceInput from '../ChoiceInput';
import FormField from '../FormField';
import {
  NAME_TAG_INTRO,
  NAME_TAG_NAME_MAX_LENGTH,
  NAME_TAG_PRINT_GUIDANCE,
  NAME_TAG_PRONOUNS_LOCKED_MESSAGE,
  NAME_TAG_REPLACEMENT_QUANTITIES,
  defaultNameTagPrintName,
  nameTagPronounsAreIncludable,
  nameTagReplacementPurchaseQuestion,
  normalizeNameTagName,
  parseNameTagReplacementQuantity,
  replacementNameTagLineDescription,
  type NameTagReplacementPurchaseQuantity,
  type NameTagReplacementQuantity,
} from '../../utils/nameTag';
import { resolvePreferredPronounsForSave } from '../../utils/preferredPronouns';
import { formatCurrency } from './registrationViewEditShared';
import RegistrationFlowHeaderBar from './RegistrationFlowHeaderBar';

type RegistrationNameTagStepProps = {
  headerTitle: string;
  showStartOver: boolean;
  loading: boolean;
  error: string;
  firstName: string;
  lastName: string;
  preferredPronouns: string;
  initialName: string;
  initialIncludePronouns: boolean | null;
  isReturningMember?: boolean;
  replacementPriceMinor?: number;
  initialReplacementQuantity?: NameTagReplacementQuantity | null;
  onBack: () => void;
  onStartOver: () => void;
  onSubmit: (value: {
    nameTagName: string;
    nameTagIncludePronouns: boolean;
    replacementQuantity?: NameTagReplacementQuantity;
  }) => void;
};

export default function RegistrationNameTagStep({
  headerTitle,
  showStartOver,
  loading,
  error,
  firstName,
  lastName,
  preferredPronouns,
  initialName,
  initialIncludePronouns,
  isReturningMember = false,
  replacementPriceMinor = 0,
  initialReplacementQuantity = null,
  onBack,
  onStartOver,
  onSubmit,
}: RegistrationNameTagStepProps) {
  const nameInputId = useId();
  const includeLabelId = useId();
  const purchaseLabelId = useId();
  const quantityInputId = useId();
  const pronounsLocked = !nameTagPronounsAreIncludable(preferredPronouns);
  const pronounsLabel = resolvePreferredPronounsForSave(preferredPronouns);
  const [nameTagName, setNameTagName] = useState(
    () => normalizeNameTagName(initialName) || defaultNameTagPrintName(firstName, lastName),
  );
  const [includePronouns, setIncludePronouns] = useState<boolean | null>(() =>
    pronounsLocked ? false : initialIncludePronouns,
  );
  const [wantsReplacement, setWantsReplacement] = useState<boolean | null>(() => {
    const quantity = parseNameTagReplacementQuantity(initialReplacementQuantity);
    if (quantity === 0) return false;
    if (quantity === 1 || quantity === 2 || quantity === 3) return true;
    return null;
  });
  const [quantity, setQuantity] = useState<NameTagReplacementPurchaseQuantity>(() => {
    const parsed = parseNameTagReplacementQuantity(initialReplacementQuantity);
    return parsed === 2 || parsed === 3 ? parsed : 1;
  });
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    setNameTagName(normalizeNameTagName(initialName) || defaultNameTagPrintName(firstName, lastName));
    setIncludePronouns(pronounsLocked ? false : initialIncludePronouns);
    const parsed = parseNameTagReplacementQuantity(initialReplacementQuantity);
    setWantsReplacement(parsed === 0 ? false : parsed === 1 || parsed === 2 || parsed === 3 ? true : null);
    setQuantity(parsed === 2 || parsed === 3 ? parsed : 1);
  }, [firstName, lastName, initialIncludePronouns, initialName, initialReplacementQuantity, pronounsLocked]);

  const showCustomizations = !isReturningMember || wantsReplacement === true;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isReturningMember && wantsReplacement === null) {
      setLocalError('Choose whether to purchase a replacement name tag.');
      return;
    }
    if (isReturningMember && wantsReplacement === false) {
      setLocalError('');
      onSubmit({
        nameTagName: normalizeNameTagName(nameTagName),
        nameTagIncludePronouns: pronounsLocked ? false : includePronouns === true,
        replacementQuantity: 0,
      });
      return;
    }
    const name = normalizeNameTagName(nameTagName);
    const include = pronounsLocked ? false : includePronouns;
    if (!name) return;
    if (!pronounsLocked && include !== true && include !== false) {
      setLocalError('Choose whether to include your pronouns on your name tag.');
      return;
    }
    setLocalError('');
    onSubmit({
      nameTagName: name,
      nameTagIncludePronouns: include === true,
      ...(isReturningMember ? { replacementQuantity: quantity } : {}),
    });
  }

  return (
    <div className="mx-auto max-w-3xl rounded-3xl border border-emerald-100 bg-white/95 p-6 shadow-xl shadow-emerald-950/10 sm:p-8">
      <RegistrationFlowHeaderBar
        backLabel="Back"
        onBack={onBack}
        headerTitle={headerTitle}
        showStartOver={showStartOver}
        loading={loading}
        onStartOver={onStartOver}
      />
      <h1 className="text-3xl font-bold text-[#121033]">Name tag</h1>
      <p className="mt-3 text-gray-600">
        {isReturningMember
          ? nameTagReplacementPurchaseQuestion(formatCurrency(replacementPriceMinor))
          : NAME_TAG_INTRO}
      </p>
      <form onSubmit={handleSubmit} className="mt-6 space-y-6">
        {isReturningMember ? (
          <FormField
            label="Purchase a replacement name tag"
            labelId={purchaseLabelId}
            required
            tone="public"
          >
            <ChoiceInput
              layout="block"
              value={wantsReplacement === true ? 'yes' : wantsReplacement === false ? 'no' : null}
              onChange={(value) => {
                setWantsReplacement(value === 'yes');
                setLocalError('');
              }}
              ariaLabelledBy={purchaseLabelId}
              options={[
                { value: 'yes', label: 'Yes' },
                { value: 'no', label: 'No' },
              ]}
            />
          </FormField>
        ) : null}
        {showCustomizations ? (
          <>
            {isReturningMember ? <p className="text-gray-600">{NAME_TAG_PRINT_GUIDANCE}</p> : null}
            <FormField label="Name to print on your name tag" htmlFor={nameInputId} required tone="public">
              <input
                id={nameInputId}
                type="text"
                value={nameTagName}
                onChange={(event) => setNameTagName(event.target.value.slice(0, NAME_TAG_NAME_MAX_LENGTH))}
                className="app-input"
                autoComplete="nickname"
                required
                maxLength={NAME_TAG_NAME_MAX_LENGTH}
              />
            </FormField>
            <FormField
              label={
                pronounsLocked
                  ? 'Include my pronouns on my name tag.'
                  : `Include my pronouns (${pronounsLabel}) on my name tag.`
              }
              labelId={includeLabelId}
              required
              tone="public"
              state={pronounsLocked ? 'disabled' : 'default'}
              helperText={pronounsLocked ? NAME_TAG_PRONOUNS_LOCKED_MESSAGE : undefined}
              helperPlacement="after-label"
            >
              <ChoiceInput
                layout="inline"
                value={pronounsLocked || includePronouns === false ? 'no' : includePronouns === true ? 'yes' : null}
                onChange={(value) => {
                  if (pronounsLocked) return;
                  setIncludePronouns(value === 'yes');
                }}
                disabled={pronounsLocked}
                ariaLabelledBy={includeLabelId}
                options={[
                  { value: 'yes', label: 'Yes' },
                  { value: 'no', label: 'No' },
                ]}
              />
            </FormField>
            {isReturningMember ? (
              <FormField
                label="Quantity"
                htmlFor={quantityInputId}
                required
                tone="public"
              >
                <ChoiceInput
                  inputId={quantityInputId}
                  layout="inline"
                  value={quantity}
                  onChange={(value) => {
                    if (value === 1 || value === 2 || value === 3) setQuantity(value);
                  }}
                  options={NAME_TAG_REPLACEMENT_QUANTITIES.map((count) => ({
                    value: count,
                    label: String(count),
                  }))}
                />
              </FormField>
            ) : null}
          </>
        ) : null}
        {localError ? <p className="text-sm text-red-600">{localError}</p> : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {isReturningMember && wantsReplacement === true ? (
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-gray-700">{replacementNameTagLineDescription(quantity)}</span>
            <span className="font-medium text-gray-900">
              {formatCurrency(replacementPriceMinor * quantity)}
            </span>
          </div>
        ) : null}
        <Button type="submit" disabled={loading}>
          Save and continue
        </Button>
      </form>
    </div>
  );
}
