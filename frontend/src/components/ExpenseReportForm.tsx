import { FormEvent, useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ChoiceInput, { type ChoiceOption } from './ChoiceInput';
import FormCheckbox from './FormCheckbox';
import FormField from './FormField';
import FormFieldMessage from './FormFieldMessage';
import FormSection from './FormSection';
import HelpCallout from './HelpCallout';
import MemberAutocomplete from './MemberAutocomplete';
import PhysicalAddressCollect from './PhysicalAddressCollect';
import Button from './Button';
import { publicEventRegistrationInput } from './eventRegistration/PublicRegistrationFieldInput';
import { emptyStructuredPostalAddress, formatStructuredPostalOneLine, type StructuredPostalAddress } from '../utils/structuredPostalAddress';
import { openExpenseReceipt } from '../utils/expenseReportSubmit';
import {
  CHARITABLE_MILEAGE_RATE_CENTS_PER_MILE,
  DURABLE_GOOD_THRESHOLD_MINOR,
  EXPENSE_TRIP_PURPOSE_OPTIONS,
  MAX_EXPENSE_RECEIPTS,
  dollarsToMinor,
  mileageCapCents,
  minorToDollarsInput,
  type ExpenseFieldError,
  type ExpenseReportKind,
  type ExpenseReportView,
  type ExpenseReceiptView,
} from '../utils/expenseReports';

export type ExpenseCommitteeOption = { id: number; name: string };

export type ExpenseFormOptions = {
  committees: ExpenseCommitteeOption[];
  clubName: string;
  mileageRateCentsPerMile: number;
  isClubCreditCardHolder: boolean;
};

export type { ExpenseFieldError };

type ReceiptDraft = {
  key: string;
  id?: number;
  name: string;
  receiptDate: string;
  amount: string;
  currency: 'usd' | 'cad' | 'other';
  currencyOther: string;
  includesDurableGood: boolean;
  file: File | null;
  existingFilename?: string;
};

type ExpenseReportFormProps = {
  tone?: 'public' | 'app';
  readOnly?: boolean;
  formOptions: ExpenseFormOptions;
  identity: {
    name: string;
    email: string;
    phone: string;
    mailingAddress: StructuredPostalAddress;
  };
  initialReport?: ExpenseReportView | null;
  fieldErrors?: ExpenseFieldError[];
  submitting?: boolean;
  submitLabel?: string;
  receiptFilePath?: (receiptId: number) => string;
  /** Staff review always asks about club cards and who holds the card. */
  clubCardMode?: 'submitter' | 'staff';
  onSubmit: (input: {
    payload: Record<string, unknown>;
    files: Array<{ index: number; file: File }>;
    removeReceiptIds: number[];
  }) => Promise<void> | void;
};

function errorMap(errors: ExpenseFieldError[] | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const error of errors ?? []) {
    map[error.field] = error.message;
  }
  return map;
}

function emptyReceipt(): ReceiptDraft {
  return {
    key: `receipt-${Math.random().toString(36).slice(2)}`,
    name: '',
    receiptDate: '',
    amount: '',
    currency: 'usd',
    currencyOther: '',
    includesDurableGood: false,
    file: null,
  };
}

function receiptsFromReport(report: ExpenseReportView): ReceiptDraft[] {
  if (!report.receipts?.length) return [emptyReceipt()];
  return report.receipts.map((receipt: ExpenseReceiptView) => ({
    key: `existing-${receipt.id}`,
    id: receipt.id,
    name: receipt.name,
    receiptDate: receipt.receiptDate.slice(0, 10),
    amount: minorToDollarsInput(receipt.amountMinor),
    currency: receipt.currency === 'cad' || receipt.currency === 'other' ? receipt.currency : 'usd',
    currencyOther: receipt.currencyOther ?? '',
    includesDurableGood: receipt.includesDurableGood,
    file: null,
    existingFilename: receipt.originalFilename,
  }));
}

export default function ExpenseReportForm({
  tone = 'public',
  readOnly = false,
  formOptions,
  identity,
  initialReport,
  fieldErrors,
  submitting = false,
  submitLabel = 'Submit report',
  receiptFilePath,
  clubCardMode = 'submitter',
  onSubmit,
}: ExpenseReportFormProps) {
  const errors = errorMap(fieldErrors);
  const inputClass = tone === 'public' ? publicEventRegistrationInput : 'app-input';
  const kindLabelId = useId();
  const committeeId = useId();
  const purposeId = useId();
  const totalId = useId();
  const justificationId = useId();
  const cardLabelId = useId();
  const commentsId = useId();
  const activityDateId = useId();
  const fromLabelId = useId();
  const fromOtherId = useId();
  const toLabelId = useId();
  const toOtherId = useId();
  const milesId = useId();
  const tripPurposeId = useId();
  const tripOtherId = useId();
  const mileageAmountId = useId();
  const receiptsLabelId = useId();
  const cardOwnerId = useId();

  const [kind, setKind] = useState<ExpenseReportKind | ''>(
    initialReport?.kind === 'mileage' ? 'mileage' : initialReport ? 'expense' : ''
  );
  const [committeeChoice, setCommitteeChoice] = useState(() => {
    if (initialReport?.committeeId) return String(initialReport.committeeId);
    if (initialReport?.committeeCustom) return 'custom';
    return '';
  });
  const [committeeCustom, setCommitteeCustom] = useState(initialReport?.committeeCustom ?? '');
  const [purpose, setPurpose] = useState(initialReport?.purpose ?? '');
  const [receipts, setReceipts] = useState<ReceiptDraft[]>(() =>
    initialReport?.kind === 'expense' ? receiptsFromReport(initialReport) : [emptyReceipt()]
  );
  const [removedReceiptIds, setRemovedReceiptIds] = useState<number[]>([]);
  const [requestedAmount, setRequestedAmount] = useState(
    initialReport ? minorToDollarsInput(initialReport.requestedAmountMinor) : ''
  );
  const [requestedTouched, setRequestedTouched] = useState(() => {
    if (!initialReport || initialReport.kind !== 'expense') return false;
    const keys = new Set(
      (initialReport.receipts ?? []).map((receipt) =>
        receipt.currency === 'other' ? `other:${(receipt.currencyOther ?? '').trim().toLowerCase()}` : receipt.currency
      )
    );
    const sum = (initialReport.receipts ?? []).reduce((total, receipt) => total + receipt.amountMinor, 0);
    return keys.size > 1 || initialReport.requestedAmountMinor !== sum;
  });
  const [amountJustification, setAmountJustification] = useState(initialReport?.amountJustification ?? '');
  const [usedClubCreditCard, setUsedClubCreditCard] = useState<'yes' | 'no' | ''>(() => {
    if (initialReport?.usedClubCreditCard === true) return 'yes';
    if (initialReport?.usedClubCreditCard === false) return 'no';
    return '';
  });
  const [cardOwnerMemberId, setCardOwnerMemberId] = useState<number | ''>(
    initialReport?.clubCreditCardOwnerMemberId ?? ''
  );
  const [cardOwnerQuery, setCardOwnerQuery] = useState(initialReport?.clubCreditCardOwnerName ?? '');
  const [mailingAddress, setMailingAddress] = useState<StructuredPostalAddress>(
    initialReport?.mailingAddress ?? identity.mailingAddress ?? emptyStructuredPostalAddress()
  );
  const [comments, setComments] = useState(initialReport?.comments ?? '');
  const [activityDate, setActivityDate] = useState(initialReport?.activityDate?.slice(0, 10) ?? '');
  const [fromKind, setFromKind] = useState(initialReport?.fromKind ?? 'home');
  const [fromOther, setFromOther] = useState(initialReport?.fromOther ?? '');
  const [toKind, setToKind] = useState(initialReport?.toKind ?? 'club');
  const [toOther, setToOther] = useState(initialReport?.toOther ?? '');
  const [roundTripMiles, setRoundTripMiles] = useState(
    initialReport?.roundTripMiles != null ? String(initialReport.roundTripMiles) : ''
  );
  const [tripPurpose, setTripPurpose] = useState(initialReport?.tripPurpose ?? '');
  const [tripPurposeOther, setTripPurposeOther] = useState(initialReport?.tripPurposeOther ?? '');
  const [mileageTouched, setMileageTouched] = useState(false);

  const clubName = formOptions.clubName || 'the club';
  const askClubCard =
    kind === 'expense' && (clubCardMode === 'staff' || formOptions.isClubCreditCardHolder);
  const showMailingAddress = kind === 'expense' && (!askClubCard || usedClubCreditCard === 'no');

  const receiptSumMinor = useMemo(
    () => receipts.reduce((sum, receipt) => sum + dollarsToMinor(receipt.amount), 0),
    [receipts]
  );
  const mixedCurrencies = useMemo(() => {
    const keys = new Set(
      receipts.map((receipt) =>
        receipt.currency === 'other' ? `other:${receipt.currencyOther.trim().toLowerCase()}` : receipt.currency
      )
    );
    return keys.size > 1;
  }, [receipts]);
  const requestedMinor = dollarsToMinor(requestedAmount);
  const amountDiffers = requestedMinor !== receiptSumMinor;
  const needsJustification = mixedCurrencies || amountDiffers;

  useEffect(() => {
    if (kind !== 'expense' || requestedTouched) return;
    setRequestedAmount(receiptSumMinor > 0 ? minorToDollarsInput(receiptSumMinor) : '');
  }, [kind, receiptSumMinor, requestedTouched]);

  useEffect(() => {
    if (kind !== 'expense' || mixedCurrencies) return;
    if (dollarsToMinor(requestedAmount) === receiptSumMinor) {
      setRequestedTouched(false);
    }
  }, [kind, mixedCurrencies, requestedAmount, receiptSumMinor]);

  const milesNumber = Number.parseFloat(roundTripMiles);
  const mileageCap = Number.isFinite(milesNumber) && milesNumber > 0 ? mileageCapCents(milesNumber) : 0;

  useEffect(() => {
    if (kind !== 'mileage' || mileageTouched) return;
    setRequestedAmount(mileageCap > 0 ? minorToDollarsInput(mileageCap) : '');
  }, [kind, mileageCap, mileageTouched]);

  const committeeOptions: ChoiceOption<string>[] = useMemo(
    () => [
      ...formOptions.committees.map((committee) => ({ value: String(committee.id), label: committee.name })),
      { value: 'custom', label: 'Other (specify)' },
    ],
    [formOptions.committees]
  );

  const updateReceipt = (index: number, patch: Partial<ReceiptDraft>) => {
    setReceipts((current) =>
      current.map((receipt, receiptIndex) => {
        if (receiptIndex !== index) return receipt;
        const next = { ...receipt, ...patch };
        if (dollarsToMinor(next.amount) < DURABLE_GOOD_THRESHOLD_MINOR) {
          next.includesDurableGood = false;
        }
        return next;
      })
    );
  };

  const removeReceipt = (index: number) => {
    const target = receipts[index];
    if (target?.id) {
      setRemovedReceiptIds((current) => [...current, target.id!]);
    }
    setReceipts((current) => (current.length <= 1 ? [emptyReceipt()] : current.filter((_, i) => i !== index)));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (readOnly || submitting || !kind) return;
    const files: Array<{ index: number; file: File }> = [];
    receipts.forEach((receipt, index) => {
      if (receipt.file) files.push({ index, file: receipt.file });
    });
    const payload: Record<string, unknown> = {
      kind,
      submitterName: identity.name,
      submitterEmail: identity.email,
      submitterPhone: identity.phone || null,
      mailingAddress: showMailingAddress ? mailingAddress : identity.mailingAddress,
      comments: comments.trim() || null,
      requestedAmountMinor: dollarsToMinor(requestedAmount),
      requestedCurrency: 'usd',
    };
    if (kind === 'expense') {
      payload.committeeId = committeeChoice && committeeChoice !== 'custom' ? Number(committeeChoice) : null;
      payload.committeeCustom = committeeChoice === 'custom' ? committeeCustom : null;
      payload.purpose = purpose;
      payload.amountJustification = needsJustification ? amountJustification.trim() || null : null;
      payload.usedClubCreditCard = !askClubCard
        ? null
        : usedClubCreditCard === 'yes'
          ? true
          : usedClubCreditCard === 'no'
            ? false
            : null;
      if (usedClubCreditCard === 'yes') {
        payload.clubCreditCardOwnerName =
          clubCardMode === 'staff' ? cardOwnerQuery.trim() || null : identity.name;
        payload.clubCreditCardOwnerMemberId =
          clubCardMode === 'staff' ? (cardOwnerMemberId === '' ? null : cardOwnerMemberId) : null;
      } else {
        payload.clubCreditCardOwnerName = null;
        payload.clubCreditCardOwnerMemberId = null;
      }
      payload.receipts = receipts.map((receipt) => ({
        id: receipt.id,
        name: receipt.name,
        receiptDate: receipt.receiptDate,
        amountMinor: dollarsToMinor(receipt.amount),
        currency: receipt.currency,
        currencyOther: receipt.currency === 'other' ? receipt.currencyOther : null,
        includesDurableGood: receipt.includesDurableGood,
      }));
      payload.removeReceiptIds = removedReceiptIds;
    } else {
      payload.activityDate = activityDate;
      payload.fromKind = fromKind;
      payload.fromOther = fromKind === 'other' ? fromOther : null;
      payload.toKind = toKind;
      payload.toOther = toKind === 'other' ? toOther : null;
      payload.roundTripMiles = Number.isFinite(milesNumber) ? milesNumber : null;
      payload.tripPurpose = tripPurpose || null;
      payload.tripPurposeOther = tripPurpose === 'other' ? tripPurposeOther : null;
      payload.receipts = [];
    }
    await onSubmit({ payload, files, removeReceiptIds: removedReceiptIds });
  };

  const kindOptions: ChoiceOption<string>[] = [
    { value: 'expense', label: 'Expense reimbursement' },
    { value: 'mileage', label: 'Mileage reimbursement' },
  ];

  const visibleErrorKeys = new Set<string>([
    'kind',
    'committee',
    'purpose',
    'requestedAmountMinor',
    'amountJustification',
    'mailingAddress',
    'activityDate',
    'fromKind',
    'fromOther',
    'toKind',
    'toOther',
    'roundTripMiles',
    'tripPurpose',
    'tripPurposeOther',
    'receipts',
  ]);
  if (askClubCard) visibleErrorKeys.add('usedClubCreditCard');
  if (askClubCard && clubCardMode === 'staff' && usedClubCreditCard === 'yes') {
    visibleErrorKeys.add('clubCreditCardOwnerName');
  }
  const leftoverErrors = (fieldErrors ?? []).filter((error) => {
    if (error.field.startsWith('receipts.')) return false;
    return !visibleErrorKeys.has(error.field);
  });

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {leftoverErrors.length > 0 ? (
        <FormFieldMessage tone={tone} intent="error">
          {leftoverErrors.map((error) => error.message).join(' ')}
        </FormFieldMessage>
      ) : null}
      <FormSection
        tone={tone}
        title="Report type"
        description={
          kind === 'mileage' ? (
            <>
              Review the{' '}
              <Link to="/go/mileagepolicy" className="text-primary-teal-link hover:underline">
                mileage policy
              </Link>
              .
            </>
          ) : kind === 'expense' ? (
            <>
              Review the{' '}
              <Link to="/go/expensepolicy" className="text-primary-teal-link hover:underline">
                expense policy
              </Link>
              .
            </>
          ) : (
            <>
              Choose the kind of reimbursement. Policies:{' '}
              <Link to="/go/expensepolicy" className="text-primary-teal-link hover:underline">
                expense
              </Link>{' '}
              and{' '}
              <Link to="/go/mileagepolicy" className="text-primary-teal-link hover:underline">
                mileage
              </Link>
              .
            </>
          )
        }
      >
        <FormField label="What are you submitting?" labelId={kindLabelId} required tone={tone} error={errors.kind}>
          <ChoiceInput
            layout="inline"
            ariaLabelledBy={kindLabelId}
            value={kind || null}
            disabled={readOnly}
            onChange={(value) => {
              const next = Array.isArray(value) ? value[0] : value;
              setKind(next === 'mileage' ? 'mileage' : 'expense');
            }}
            options={kindOptions}
          />
        </FormField>
      </FormSection>

      {kind === 'expense' ? (
        <>
          <FormSection tone={tone} title="Expense details">
            <FormField label="Committee" htmlFor={committeeId} required tone={tone} error={errors.committee}>
              <ChoiceInput
                inputId={committeeId}
                layout="popover"
                value={committeeChoice || null}
                disabled={readOnly}
                placeholder="Select a committee"
                onChange={(value) => {
                  const next = Array.isArray(value) ? value[0] : value;
                  setCommitteeChoice(typeof next === 'string' ? next : '');
                }}
                options={committeeOptions}
              />
            </FormField>
            {committeeChoice === 'custom' ? (
              <FormField label="Custom committee" htmlFor={`${committeeId}-custom`} required tone={tone}>
                <input
                  id={`${committeeId}-custom`}
                  className={inputClass}
                  value={committeeCustom}
                  readOnly={readOnly}
                  onChange={(event) => setCommitteeCustom(event.target.value)}
                />
              </FormField>
            ) : null}
            <FormField
              label="Purpose"
              htmlFor={purposeId}
              required
              tone={tone}
              error={errors.purpose}
              helperText="Provide the event, project, activity, or other justification for this expense."
            >
              <textarea
                id={purposeId}
                className={inputClass}
                rows={3}
                value={purpose}
                readOnly={readOnly}
                onChange={(event) => setPurpose(event.target.value)}
              />
            </FormField>
          </FormSection>

          <FormSection tone={tone} title="Receipts" description="Add one or more receipts. PDF, JPEG, PNG, WebP, or HEIC, up to 10 MB each.">
            <div role="group" aria-labelledby={receiptsLabelId} className="space-y-4">
              <h3 id={receiptsLabelId} className="sr-only">
                Receipts
              </h3>
              {receipts.map((receipt, index) => {
                const amountMinor = dollarsToMinor(receipt.amount);
                const durableDisabled = readOnly || amountMinor < DURABLE_GOOD_THRESHOLD_MINOR;
                const fileId = `${receiptsLabelId}-${index}-file`;
                return (
                  <div
                    key={receipt.key}
                    role="group"
                    aria-labelledby={`${receiptsLabelId}-${index}`}
                    className="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-gray-700"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <h4 id={`${receiptsLabelId}-${index}`} className="text-sm font-medium text-gray-800 dark:text-gray-200">
                        Receipt {index + 1}
                      </h4>
                      {!readOnly && receipts.length > 1 ? (
                        <Button type="button" variant="secondary" onClick={() => removeReceipt(index)}>
                          Remove
                        </Button>
                      ) : null}
                    </div>
                    <FormField
                      label="Expense name"
                      htmlFor={`${receiptsLabelId}-${index}-name`}
                      required
                      tone={tone}
                      error={errors[`receipts.${index}.name`]}
                    >
                      <input
                        id={`${receiptsLabelId}-${index}-name`}
                        className={inputClass}
                        value={receipt.name}
                        readOnly={readOnly}
                        onChange={(event) => updateReceipt(index, { name: event.target.value })}
                      />
                    </FormField>
                    <FormField
                      label="Date"
                      htmlFor={`${receiptsLabelId}-${index}-date`}
                      required
                      tone={tone}
                      error={errors[`receipts.${index}.receiptDate`]}
                    >
                      <input
                        id={`${receiptsLabelId}-${index}-date`}
                        type="date"
                        className={inputClass}
                        value={receipt.receiptDate}
                        readOnly={readOnly}
                        onChange={(event) => updateReceipt(index, { receiptDate: event.target.value })}
                      />
                    </FormField>
                    <FormField
                      label="Amount"
                      htmlFor={`${receiptsLabelId}-${index}-amount`}
                      required
                      tone={tone}
                      error={errors[`receipts.${index}.amountMinor`]}
                    >
                      <input
                        id={`${receiptsLabelId}-${index}-amount`}
                        inputMode="decimal"
                        className={inputClass}
                        value={receipt.amount}
                        readOnly={readOnly}
                        onChange={(event) => updateReceipt(index, { amount: event.target.value })}
                      />
                    </FormField>
                    <FormField
                      label="Currency"
                      htmlFor={`${receiptsLabelId}-${index}-currency`}
                      required
                      tone={tone}
                    >
                      <ChoiceInput
                        inputId={`${receiptsLabelId}-${index}-currency`}
                        layout="popover"
                        value={receipt.currency}
                        disabled={readOnly}
                        onChange={(value) => {
                          const next = Array.isArray(value) ? value[0] : value;
                          updateReceipt(index, {
                            currency: next === 'cad' || next === 'other' ? next : 'usd',
                          });
                        }}
                        options={[
                          { value: 'usd', label: 'USD' },
                          { value: 'cad', label: 'CAD' },
                          { value: 'other', label: 'Other' },
                        ]}
                      />
                    </FormField>
                    {receipt.currency === 'other' ? (
                      <FormField
                        label="Other currency"
                        htmlFor={`${receiptsLabelId}-${index}-currency-other`}
                        required
                        tone={tone}
                        error={errors[`receipts.${index}.currencyOther`]}
                      >
                        <input
                          id={`${receiptsLabelId}-${index}-currency-other`}
                          className={inputClass}
                          value={receipt.currencyOther}
                          readOnly={readOnly}
                          onChange={(event) => updateReceipt(index, { currencyOther: event.target.value })}
                        />
                      </FormField>
                    ) : null}
                    {!readOnly ? (
                      <FormField
                        label="Receipt file"
                        htmlFor={fileId}
                        required={!receipt.id}
                        tone={tone}
                        error={errors[`receipts.${index}.file`]}
                        helperText={
                          receipt.existingFilename && !receipt.file
                            ? `Current file: ${receipt.existingFilename}`
                            : undefined
                        }
                      >
                        <input
                          id={fileId}
                          type="file"
                          className={inputClass}
                          accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
                          onChange={(event) => updateReceipt(index, { file: event.target.files?.[0] ?? null })}
                        />
                      </FormField>
                    ) : null}
                    {receipt.id && receiptFilePath && receipt.existingFilename ? (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void openExpenseReceipt(receiptFilePath(receipt.id!))}
                      >
                        View receipt file
                      </Button>
                    ) : null}
                    <div className="flex items-start gap-2">
                      <div className="flex-1">
                        <FormCheckbox
                          tone={tone}
                          disabled={durableDisabled}
                          checked={receipt.includesDurableGood}
                          onChange={(checked) => updateReceipt(index, { includesDurableGood: checked })}
                          label="This receipt includes a durable good"
                          helperText={
                            durableDisabled && !readOnly
                              ? 'Disabled because this receipt is under $200.'
                              : undefined
                          }
                        />
                      </div>
                      <HelpCallout
                        className="mt-0.5"
                        label="What is a durable good?"
                        text="A durable good is anything over $200 that is expected to be in use for 3 or more years."
                      />
                    </div>
                  </div>
                );
              })}
              {!readOnly && receipts.length < MAX_EXPENSE_RECEIPTS ? (
                <Button type="button" variant="secondary" onClick={() => setReceipts((current) => [...current, emptyReceipt()])}>
                  Add another receipt
                </Button>
              ) : null}
            </div>
          </FormSection>

          <FormSection tone={tone} title="Reimbursement">
            <FormField
              label="Total reimbursement requested"
              htmlFor={totalId}
              required
              tone={tone}
              error={errors.requestedAmountMinor}
              helperText={
                mixedCurrencies
                  ? 'Receipts use more than one currency. Enter the USD amount to reimburse and explain the difference.'
                  : 'Defaults to the sum of the receipts. Edit if needed and explain any difference.'
              }
            >
              <input
                id={totalId}
                inputMode="decimal"
                className={inputClass}
                value={requestedAmount}
                readOnly={readOnly}
                onChange={(event) => {
                  const next = event.target.value;
                  setRequestedAmount(next);
                  setRequestedTouched(mixedCurrencies || dollarsToMinor(next) !== receiptSumMinor);
                }}
              />
            </FormField>
            {needsJustification ? (
              <FormField
                label="Justification for the difference"
                htmlFor={justificationId}
                required
                tone={tone}
                error={errors.amountJustification}
              >
                <textarea
                  id={justificationId}
                  className={inputClass}
                  rows={3}
                  value={amountJustification}
                  readOnly={readOnly}
                  onChange={(event) => setAmountJustification(event.target.value)}
                />
              </FormField>
            ) : null}
            {askClubCard ? (
              <>
                <FormField
                  label={
                    clubCardMode === 'staff'
                      ? `Was this expense incurred on a ${clubName} credit card?`
                      : `Was this expense incurred on your ${clubName} credit card?`
                  }
                  labelId={cardLabelId}
                  required
                  tone={tone}
                  error={errors.usedClubCreditCard}
                >
                  <ChoiceInput
                    layout="inline"
                    ariaLabelledBy={cardLabelId}
                    value={usedClubCreditCard || null}
                    disabled={readOnly}
                    onChange={(value) => {
                      const next = Array.isArray(value) ? value[0] : value;
                      setUsedClubCreditCard(next === 'yes' ? 'yes' : 'no');
                    }}
                    options={[
                      { value: 'yes', label: 'Yes' },
                      { value: 'no', label: 'No' },
                    ]}
                  />
                </FormField>
                {clubCardMode === 'staff' && usedClubCreditCard === 'yes' ? (
                  <FormField
                    label="Credit card owner"
                    htmlFor={readOnly ? undefined : cardOwnerId}
                    required
                    tone={tone}
                    helperText={
                      readOnly
                        ? undefined
                        : 'Select the member who holds the club credit card charged for this expense.'
                    }
                    error={errors.clubCreditCardOwnerName}
                  >
                    {readOnly ? (
                      <p className="text-sm text-gray-800 dark:text-gray-200">
                        {cardOwnerQuery || initialReport?.clubCreditCardOwnerName || 'Not provided'}
                      </p>
                    ) : (
                      <MemberAutocomplete
                        inputId={cardOwnerId}
                        value={cardOwnerMemberId}
                        onChange={setCardOwnerMemberId}
                        inputValue={cardOwnerQuery}
                        onInputValueChange={setCardOwnerQuery}
                        onSelectOption={(option) => {
                          setCardOwnerMemberId(option.id);
                          setCardOwnerQuery(option.name);
                        }}
                        selectedOption={
                          cardOwnerMemberId
                            ? undefined
                            : cardOwnerQuery
                              ? { id: -1, name: cardOwnerQuery }
                              : null
                        }
                        placeholder="Search members"
                      />
                    )}
                  </FormField>
                ) : null}
              </>
            ) : null}
            {showMailingAddress ? (
              readOnly ? (
                <FormField label="Mailing address for the reimbursement check" tone={tone}>
                  <p className="text-sm text-gray-800 dark:text-gray-200">
                    {formatStructuredPostalOneLine(mailingAddress) || 'Not provided'}
                  </p>
                </FormField>
              ) : (
                <PhysicalAddressCollect
                  tone={tone}
                  required
                  value={mailingAddress}
                  onChange={setMailingAddress}
                  sectionTitle="Mailing address for the reimbursement check"
                />
              )
            ) : null}
            {errors.mailingAddress ? (
              <p className="text-sm text-red-600">{errors.mailingAddress}</p>
            ) : null}
          </FormSection>
        </>
      ) : null}

      {kind === 'mileage' ? (
        <FormSection
          tone={tone}
          title="Mileage details"
          description={
            <>
              Reimbursement uses the charitable organization rate of $
              {(formOptions.mileageRateCentsPerMile / 100).toFixed(2)} per mile. Review the{' '}
              <Link to="/go/mileagepolicy" className="text-primary-teal-link hover:underline">
                mileage policy
              </Link>
              .
            </>
          }
        >
          <FormField label="Date of volunteer activity" htmlFor={activityDateId} required tone={tone} error={errors.activityDate}>
            <input
              id={activityDateId}
              type="date"
              className={inputClass}
              value={activityDate}
              readOnly={readOnly}
              onChange={(event) => setActivityDate(event.target.value)}
            />
          </FormField>
          <FormField label="From" labelId={fromLabelId} required tone={tone} error={errors.fromKind}>
            <ChoiceInput
              layout="inline"
              ariaLabelledBy={fromLabelId}
              value={fromKind}
              disabled={readOnly}
              onChange={(value) => {
                const next = Array.isArray(value) ? value[0] : value;
                setFromKind(next === 'other' ? 'other' : 'home');
              }}
              options={[
                { value: 'home', label: 'Home' },
                { value: 'other', label: 'Other (specify)' },
              ]}
            />
          </FormField>
          {fromKind === 'other' ? (
            <FormField label="Starting location" htmlFor={fromOtherId} required tone={tone} error={errors.fromOther}>
              <input
                id={fromOtherId}
                className={inputClass}
                value={fromOther}
                readOnly={readOnly}
                onChange={(event) => setFromOther(event.target.value)}
              />
            </FormField>
          ) : null}
          <FormField label="To" labelId={toLabelId} required tone={tone} error={errors.toKind}>
            <ChoiceInput
              layout="inline"
              ariaLabelledBy={toLabelId}
              value={toKind}
              disabled={readOnly}
              onChange={(value) => {
                const next = Array.isArray(value) ? value[0] : value;
                setToKind(next === 'other' ? 'other' : 'club');
              }}
              options={[
                { value: 'club', label: clubName },
                { value: 'other', label: 'Other (specify)' },
              ]}
            />
          </FormField>
          {toKind === 'other' ? (
            <FormField label="Destination" htmlFor={toOtherId} required tone={tone} error={errors.toOther}>
              <input
                id={toOtherId}
                className={inputClass}
                value={toOther}
                readOnly={readOnly}
                onChange={(event) => setToOther(event.target.value)}
              />
            </FormField>
          ) : null}
          <FormField
            label="Round trip mileage"
            htmlFor={milesId}
            required
            tone={tone}
            error={errors.roundTripMiles}
            helperText="Use the actual odometer difference or a Google Maps distance."
          >
            <input
              id={milesId}
              inputMode="decimal"
              className={inputClass}
              value={roundTripMiles}
              readOnly={readOnly}
              onChange={(event) => setRoundTripMiles(event.target.value)}
            />
          </FormField>
          <FormField label="Purpose of trip" htmlFor={tripPurposeId} required tone={tone} error={errors.tripPurpose}>
            <ChoiceInput
              inputId={tripPurposeId}
              layout="popover"
              value={tripPurpose || null}
              disabled={readOnly}
              placeholder="Select a purpose"
              onChange={(value) => {
                const next = Array.isArray(value) ? value[0] : value;
                setTripPurpose(typeof next === 'string' ? next : '');
              }}
              options={[...EXPENSE_TRIP_PURPOSE_OPTIONS]}
            />
          </FormField>
          {tripPurpose === 'other' ? (
            <FormField label="Other purpose" htmlFor={tripOtherId} required tone={tone} error={errors.tripPurposeOther}>
              <input
                id={tripOtherId}
                className={inputClass}
                value={tripPurposeOther}
                readOnly={readOnly}
                onChange={(event) => setTripPurposeOther(event.target.value)}
              />
            </FormField>
          ) : null}
          <FormField
            label="Requested reimbursement"
            htmlFor={mileageAmountId}
            required
            tone={tone}
            error={errors.requestedAmountMinor}
            helperText={`Defaults to $${minorToDollarsInput(CHARITABLE_MILEAGE_RATE_CENTS_PER_MILE)} per mile. You may reduce this amount, but not exceed it.`}
          >
            <input
              id={mileageAmountId}
              inputMode="decimal"
              className={inputClass}
              value={requestedAmount}
              readOnly={readOnly}
              onChange={(event) => {
                setMileageTouched(true);
                setRequestedAmount(event.target.value);
              }}
            />
          </FormField>
        </FormSection>
      ) : null}

      {kind ? (
        <FormSection tone={tone} title="Additional comments">
          <FormField label="Any additional comments about this expense?" htmlFor={commentsId} optional tone={tone}>
            <textarea
              id={commentsId}
              className={inputClass}
              rows={3}
              value={comments}
              readOnly={readOnly}
              onChange={(event) => setComments(event.target.value)}
            />
          </FormField>
        </FormSection>
      ) : null}

      {!readOnly ? (
        <div className="flex justify-end">
          <Button type="submit" disabled={submitting || !kind}>
            {submitting ? 'Submitting…' : submitLabel}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
