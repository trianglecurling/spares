import { FormEvent, useEffect, useId, useMemo, useState } from 'react';
import { HiChevronDown } from 'react-icons/hi2';
import { Link } from 'react-router-dom';
import ChoiceInput, { type ChoiceOption } from './ChoiceInput';
import FormCheckbox from './FormCheckbox';
import FormField from './FormField';
import FormFieldMessage from './FormFieldMessage';
import FormSection from './FormSection';
import HelpCallout from './HelpCallout';
import MemberAutocomplete from './MemberAutocomplete';
import { MobileNavAccordionPanel } from './MobileNavAccordion';
import PhysicalAddressCollect from './PhysicalAddressCollect';
import Button from './Button';
import { publicEventRegistrationInput } from './eventRegistration/PublicRegistrationFieldInput';
import { emptyStructuredPostalAddress, formatStructuredPostalOneLine, type StructuredPostalAddress } from '../utils/structuredPostalAddress';
import { openExpenseReceipt } from '../utils/expenseReportSubmit';
import {
  CHARITABLE_MILEAGE_RATE_CENTS_PER_MILE,
  DURABLE_GOOD_THRESHOLD_MINOR,
  EXPENSE_TRIP_PURPOSE_OPTIONS,
  MAX_EXPENSE_DOCUMENTS,
  MAX_EXPENSE_ITEMS,
  asExpenseDocumentType,
  dollarsToMinor,
  formatExpenseMoney,
  mileageCapCents,
  minorToDollarsInput,
  type ExpenseDocumentView,
  type ExpenseDocumentType,
  type ExpenseFieldError,
  type ExpenseItemView,
  type ExpenseReportKind,
  type ExpenseReportView,
} from '../utils/expenseReports';

export type ExpenseCommitteeOption = { id: number; name: string };

export type ExpenseFormOptions = {
  committees: ExpenseCommitteeOption[];
  clubName: string;
  mileageRateCentsPerMile: number;
  isClubCreditCardHolder: boolean;
};

export type { ExpenseFieldError };

type ExpenseDocumentDraft = {
  key: string;
  id?: number;
  documentType: ExpenseDocumentType;
  file: File | null;
  existingFilename?: string;
};

type ExpenseDraft = {
  key: string;
  id?: number;
  name: string;
  expenseDate: string;
  amount: string;
  currency: 'usd' | 'cad' | 'other';
  currencyOther: string;
  includesDurableGood: boolean;
  noReceipt: boolean;
  noReceiptExplanation: string;
  documents: ExpenseDocumentDraft[];
};

type ExpenseReportFormProps = {
  tone?: 'public' | 'app';
  readOnly?: boolean;
  formId?: string;
  density?: 'default' | 'compact';
  showSubmitButton?: boolean;
  showExistingReceiptActions?: boolean;
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
  documentFilePath?: (documentId: number) => string;
  /** Staff review always asks about club cards and who holds the card. */
  clubCardMode?: 'submitter' | 'staff';
  onSubmit: (input: {
    payload: Record<string, unknown>;
    files: Array<{ expenseIndex: number; documentIndex: number; file: File }>;
    removeExpenseIds: number[];
    removeDocumentIds: number[];
  }) => Promise<void> | void;
};

function errorMap(errors: ExpenseFieldError[] | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const error of errors ?? []) {
    map[error.field] = error.message;
  }
  return map;
}

function emptyDocument(documentType: ExpenseDocumentType): ExpenseDocumentDraft {
  return {
    key: `document-${Math.random().toString(36).slice(2)}`,
    documentType,
    file: null,
  };
}

function emptyExpense(): ExpenseDraft {
  return {
    key: `expense-${Math.random().toString(36).slice(2)}`,
    name: '',
    expenseDate: '',
    amount: '',
    currency: 'usd',
    currencyOther: '',
    includesDurableGood: false,
    noReceipt: false,
    noReceiptExplanation: '',
    documents: [emptyDocument('receipt')],
  };
}

function documentFromReport(document: ExpenseDocumentView): ExpenseDocumentDraft {
  return {
    key: `existing-document-${document.id}`,
    id: document.id,
    documentType: asExpenseDocumentType(document.documentType),
    file: null,
    existingFilename: document.originalFilename,
  };
}

function expenseSummary(expense: ExpenseDraft): string {
  const parts: string[] = [];
  if (expense.name.trim()) parts.push(expense.name.trim());
  if (expense.expenseDate) parts.push(expense.expenseDate);
  const amountMinor = dollarsToMinor(expense.amount);
  if (amountMinor > 0) {
    parts.push(
      formatExpenseMoney(
        amountMinor,
        expense.currency === 'other' ? expense.currencyOther || 'usd' : expense.currency
      )
    );
  }
  return parts.join(' · ');
}

function expensesFromReport(report: ExpenseReportView): ExpenseDraft[] {
  if (!report.expenses?.length) return [emptyExpense()];
  return report.expenses.map((expense: ExpenseItemView) => {
    const documents = expense.documents.map(documentFromReport);
    const hasReceipt = documents.some((document) => document.documentType === 'receipt');
    return {
      key: `existing-expense-${expense.id}`,
      id: expense.id,
      name: expense.name,
      expenseDate: expense.expenseDate.slice(0, 10),
      amount: minorToDollarsInput(expense.amountMinor),
      currency: expense.currency === 'cad' || expense.currency === 'other' ? expense.currency : 'usd',
      currencyOther: expense.currencyOther ?? '',
      includesDurableGood: expense.includesDurableGood,
      noReceipt: !hasReceipt,
      noReceiptExplanation: expense.noReceiptExplanation ?? '',
      documents,
    };
  });
}

export default function ExpenseReportForm({
  tone = 'public',
  readOnly = false,
  formId,
  density = 'default',
  showSubmitButton = true,
  showExistingReceiptActions = true,
  formOptions,
  identity,
  initialReport,
  fieldErrors,
  submitting = false,
  submitLabel = 'Submit report',
  documentFilePath,
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
  const expensesLabelId = useId();
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
  const [expenses, setExpenses] = useState<ExpenseDraft[]>(() =>
    initialReport?.kind === 'expense' ? expensesFromReport(initialReport) : [emptyExpense()]
  );
  const [expandedExpenseKey, setExpandedExpenseKey] = useState<string | null>(() => {
    if (initialReport?.kind === 'expense' && (initialReport.expenses?.length ?? 0) > 1) {
      return `existing-expense-${initialReport.expenses![0].id}`;
    }
    return null;
  });
  const [removedExpenseIds, setRemovedExpenseIds] = useState<number[]>([]);
  const [removedDocumentIds, setRemovedDocumentIds] = useState<number[]>([]);
  const [requestedAmount, setRequestedAmount] = useState(
    initialReport ? minorToDollarsInput(initialReport.requestedAmountMinor) : ''
  );
  const [requestedTouched, setRequestedTouched] = useState(() => {
    if (!initialReport || initialReport.kind !== 'expense') return false;
    const keys = new Set(
      (initialReport.expenses ?? []).map((expense) =>
        expense.currency === 'other' ? `other:${(expense.currencyOther ?? '').trim().toLowerCase()}` : expense.currency
      )
    );
    const sum = (initialReport.expenses ?? []).reduce((total, expense) => total + expense.amountMinor, 0);
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
  const chargedToClubCard = usedClubCreditCard === 'yes';
  const showReimbursementRequest =
    kind === 'expense' && !chargedToClubCard && (!askClubCard || usedClubCreditCard === 'no');
  const showMailingAddress = showReimbursementRequest;

  const expenseSumMinor = useMemo(
    () => expenses.reduce((sum, expense) => sum + dollarsToMinor(expense.amount), 0),
    [expenses]
  );
  const mixedCurrencies = useMemo(() => {
    const keys = new Set(
      expenses.map((expense) =>
        expense.currency === 'other'
          ? `other:${expense.currencyOther.trim().toLowerCase()}`
          : expense.currency
      )
    );
    return keys.size > 1;
  }, [expenses]);
  const documentCount = useMemo(
    () => expenses.reduce((sum, expense) => sum + expense.documents.length, 0),
    [expenses]
  );
  const useExpenseAccordion = expenses.length > 1;
  const activeExpenseKey = useExpenseAccordion ? expandedExpenseKey : expenses[0]?.key ?? null;
  const requestedMinor = dollarsToMinor(requestedAmount);
  const amountDiffers = requestedMinor !== expenseSumMinor;
  const needsJustification = mixedCurrencies || amountDiffers;

  useEffect(() => {
    if (kind !== 'expense' || requestedTouched) return;
    setRequestedAmount(expenseSumMinor > 0 ? minorToDollarsInput(expenseSumMinor) : '');
  }, [kind, expenseSumMinor, requestedTouched]);

  useEffect(() => {
    if (kind !== 'expense' || mixedCurrencies) return;
    if (dollarsToMinor(requestedAmount) === expenseSumMinor) {
      setRequestedTouched(false);
    }
  }, [kind, mixedCurrencies, requestedAmount, expenseSumMinor]);

  const milesNumber = Number.parseFloat(roundTripMiles);
  const mileageCap = Number.isFinite(milesNumber) && milesNumber > 0 ? mileageCapCents(milesNumber) : 0;

  useEffect(() => {
    if (kind !== 'mileage' || mileageTouched) return;
    setRequestedAmount(mileageCap > 0 ? minorToDollarsInput(mileageCap) : '');
  }, [kind, mileageCap, mileageTouched]);

  useEffect(() => {
    if (!useExpenseAccordion) return;
    const firstError = (fieldErrors ?? []).find((error) => error.field.startsWith('expenses.'));
    const match = firstError ? /^expenses\.(\d+)/.exec(firstError.field) : null;
    if (!match) return;
    const key = expenses[Number(match[1])]?.key;
    if (key) setExpandedExpenseKey(key);
  }, [fieldErrors, expenses, useExpenseAccordion]);

  const committeeOptions: ChoiceOption<string>[] = useMemo(
    () => [
      ...formOptions.committees.map((committee) => ({ value: String(committee.id), label: committee.name })),
      { value: 'custom', label: 'Other (specify)' },
    ],
    [formOptions.committees]
  );

  const updateExpense = (index: number, patch: Partial<ExpenseDraft>) => {
    setExpenses((current) =>
      current.map((expense, expenseIndex) => {
        if (expenseIndex !== index) return expense;
        const next = { ...expense, ...patch };
        if (dollarsToMinor(next.amount) < DURABLE_GOOD_THRESHOLD_MINOR) {
          next.includesDurableGood = false;
        }
        return next;
      })
    );
  };

  const updateDocument = (
    expenseIndex: number,
    documentIndex: number,
    patch: Partial<ExpenseDocumentDraft>
  ) => {
    const expense = expenses[expenseIndex];
    updateExpense(expenseIndex, {
      documents: expense.documents.map((document, index) =>
        index === documentIndex ? { ...document, ...patch } : document
      ),
    });
  };

  const removeDocument = (expenseIndex: number, documentIndex: number) => {
    const expense = expenses[expenseIndex];
    const target = expense.documents[documentIndex];
    if (target?.id) {
      setRemovedDocumentIds((current) => [...current, target.id!]);
    }
    updateExpense(expenseIndex, {
      documents: expense.documents.filter((_, index) => index !== documentIndex),
    });
  };

  const setNoReceipt = (expenseIndex: number, noReceipt: boolean) => {
    const expense = expenses[expenseIndex];
    if (noReceipt) {
      const receipt = expense.documents.find((document) => document.documentType === 'receipt');
      if (receipt?.id) {
        setRemovedDocumentIds((current) => [...current, receipt.id!]);
      }
      updateExpense(expenseIndex, {
        noReceipt: true,
        documents: expense.documents.filter((document) => document.documentType !== 'receipt'),
      });
      return;
    }
    updateExpense(expenseIndex, {
      noReceipt: false,
      noReceiptExplanation: '',
      documents: expense.documents.some((document) => document.documentType === 'receipt')
        ? expense.documents
        : [emptyDocument('receipt'), ...expense.documents],
    });
  };

  const removeExpense = (index: number) => {
    const target = expenses[index];
    if (target?.id) {
      setRemovedExpenseIds((current) => [...current, target.id!]);
    } else {
      const existingDocumentIds = target.documents
        .map((document) => document.id)
        .filter((id): id is number => Boolean(id));
      setRemovedDocumentIds((current) => [...current, ...existingDocumentIds]);
    }
    const remaining =
      expenses.length <= 1 ? [emptyExpense()] : expenses.filter((_, expenseIndex) => expenseIndex !== index);
    setExpenses(remaining);
    if (expandedExpenseKey && !remaining.some((item) => item.key === expandedExpenseKey)) {
      const fallbackIndex = Math.min(index, remaining.length - 1);
      setExpandedExpenseKey(remaining[Math.max(0, fallbackIndex)]?.key ?? remaining[0]?.key ?? null);
    }
  };

  const addExpense = () => {
    const next = emptyExpense();
    setExpenses((current) => [...current, next]);
    setExpandedExpenseKey(next.key);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (readOnly || submitting || !kind) return;
    const files: Array<{ expenseIndex: number; documentIndex: number; file: File }> = [];
    expenses.forEach((expense, expenseIndex) => {
      expense.documents.forEach((document, documentIndex) => {
        if (document.file) files.push({ expenseIndex, documentIndex, file: document.file });
      });
    });
    const payload: Record<string, unknown> = {
      kind,
      submitterName: identity.name,
      submitterEmail: identity.email,
      submitterPhone: identity.phone || null,
      mailingAddress: showMailingAddress ? mailingAddress : identity.mailingAddress,
      comments: comments.trim() || null,
      requestedAmountMinor: chargedToClubCard ? 0 : dollarsToMinor(requestedAmount),
      requestedCurrency: 'usd',
    };
    if (kind === 'expense') {
      payload.committeeId = committeeChoice && committeeChoice !== 'custom' ? Number(committeeChoice) : null;
      payload.committeeCustom = committeeChoice === 'custom' ? committeeCustom : null;
      payload.purpose = purpose;
      payload.amountJustification =
        chargedToClubCard || !needsJustification ? null : amountJustification.trim() || null;
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
      payload.expenses = expenses.map((expense) => ({
        id: expense.id,
        name: expense.name,
        expenseDate: expense.expenseDate,
        amountMinor: dollarsToMinor(expense.amount),
        currency: expense.currency,
        currencyOther: expense.currency === 'other' ? expense.currencyOther : null,
        includesDurableGood: expense.includesDurableGood,
        noReceiptExplanation: expense.noReceipt
          ? expense.noReceiptExplanation.trim() || null
          : null,
        documents: expense.documents.map((document) => ({
          id: document.id,
          documentType: document.documentType,
        })),
      }));
      payload.removeExpenseIds = removedExpenseIds;
      payload.removeDocumentIds = removedDocumentIds;
    } else {
      payload.activityDate = activityDate;
      payload.fromKind = fromKind;
      payload.fromOther = fromKind === 'other' ? fromOther : null;
      payload.toKind = toKind;
      payload.toOther = toKind === 'other' ? toOther : null;
      payload.roundTripMiles = Number.isFinite(milesNumber) ? milesNumber : null;
      payload.tripPurpose = tripPurpose || null;
      payload.tripPurposeOther = tripPurpose === 'other' ? tripPurposeOther : null;
      payload.expenses = [];
    }
    await onSubmit({ payload, files, removeExpenseIds: removedExpenseIds, removeDocumentIds: removedDocumentIds });
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
    'expenses',
  ]);
  if (askClubCard) visibleErrorKeys.add('usedClubCreditCard');
  if (askClubCard && clubCardMode === 'staff' && usedClubCreditCard === 'yes') {
    visibleErrorKeys.add('clubCreditCardOwnerName');
  }
  const leftoverErrors = (fieldErrors ?? []).filter((error) => {
    if (error.field.startsWith('expenses.')) return false;
    return !visibleErrorKeys.has(error.field);
  });

  return (
    <form
      id={formId}
      onSubmit={handleSubmit}
      className={density === 'compact' ? 'space-y-5' : 'space-y-8'}
    >
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

          <FormSection
            tone={tone}
            title="Expenses"
            description="List each expense separately. Every expense needs one receipt or an explanation for why no receipt is available."
          >
            <div
              role="group"
              aria-labelledby={expensesLabelId}
              className={useExpenseAccordion ? 'space-y-3' : 'space-y-7'}
            >
              <h3 id={expensesLabelId} className="sr-only">
                Expenses
              </h3>
              {errors.expenses ? (
                <FormFieldMessage tone={tone} intent="error">
                  {errors.expenses}
                </FormFieldMessage>
              ) : null}
              {expenses.map((expense, expenseIndex) => {
                const amountMinor = dollarsToMinor(expense.amount);
                const durableDisabled = readOnly || amountMinor < DURABLE_GOOD_THRESHOLD_MINOR;
                const receiptIndex = expense.documents.findIndex(
                  (document) => document.documentType === 'receipt'
                );
                const receipt = receiptIndex >= 0 ? expense.documents[receiptIndex] : null;
                const supportingDocuments = expense.documents
                  .map((document, documentIndex) => ({ document, documentIndex }))
                  .filter(({ document }) => document.documentType !== 'receipt');
                const receiptChoiceLabelId = `${expensesLabelId}-${expenseIndex}-receipt-choice`;
                const headingId = `${expensesLabelId}-${expenseIndex}`;
                const panelId = `${expensesLabelId}-${expenseIndex}-panel`;
                const expanded = !useExpenseAccordion || activeExpenseKey === expense.key;
                const summary = expenseSummary(expense);
                return (
                  <section
                    key={expense.key}
                    role="group"
                    aria-labelledby={headingId}
                    className={
                      useExpenseAccordion
                        ? 'rounded-lg border border-gray-200 dark:border-gray-700'
                        : 'space-y-5 border-t border-gray-200 pt-6 first:border-t-0 first:pt-0 dark:border-gray-700'
                    }
                  >
                    <div
                      className={
                        useExpenseAccordion
                          ? `flex items-start justify-between gap-3 px-4 py-3 ${
                              expanded ? 'border-b border-gray-200 dark:border-gray-700' : ''
                            }`
                          : 'flex items-center justify-between gap-3'
                      }
                    >
                      {useExpenseAccordion ? (
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-start gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40"
                          aria-expanded={expanded}
                          aria-controls={panelId}
                          onClick={() =>
                            setExpandedExpenseKey((current) =>
                              current === expense.key ? null : expense.key
                            )
                          }
                        >
                          <span className="min-w-0 flex-1">
                            <span
                              id={headingId}
                              className="block text-base font-semibold text-gray-900 dark:text-gray-100"
                            >
                              Expense {expenseIndex + 1}
                            </span>
                            {!expanded && summary ? (
                              <span className="mt-0.5 block truncate text-sm text-gray-600 dark:text-gray-400">
                                {summary}
                              </span>
                            ) : null}
                          </span>
                          <HiChevronDown
                            className={`mt-0.5 h-5 w-5 shrink-0 text-gray-500 transition-transform motion-reduce:transition-none ${
                              expanded ? 'rotate-180' : ''
                            }`}
                            aria-hidden
                          />
                        </button>
                      ) : (
                        <h4
                          id={headingId}
                          className="text-base font-semibold text-gray-900 dark:text-gray-100"
                        >
                          Expense {expenseIndex + 1}
                        </h4>
                      )}
                      {!readOnly && expenses.length > 1 ? (
                        <Button type="button" variant="secondary" onClick={() => removeExpense(expenseIndex)}>
                          Remove expense
                        </Button>
                      ) : null}
                    </div>
                    <MobileNavAccordionPanel expanded={expanded}>
                    <div
                      id={useExpenseAccordion ? panelId : undefined}
                      className={useExpenseAccordion ? 'space-y-5 px-4 py-4' : 'space-y-5'}
                    >
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_minmax(9rem,1fr)_minmax(8rem,0.8fr)_minmax(8rem,0.8fr)]">
                      <FormField
                        label="Expense name"
                        htmlFor={`${expensesLabelId}-${expenseIndex}-name`}
                        required
                        tone={tone}
                        error={errors[`expenses.${expenseIndex}.name`]}
                      >
                        <input
                          id={`${expensesLabelId}-${expenseIndex}-name`}
                          className={inputClass}
                          value={expense.name}
                          readOnly={readOnly}
                          onChange={(event) => updateExpense(expenseIndex, { name: event.target.value })}
                        />
                      </FormField>
                      <FormField
                        label="Date"
                        htmlFor={`${expensesLabelId}-${expenseIndex}-date`}
                        required
                        tone={tone}
                        error={errors[`expenses.${expenseIndex}.expenseDate`]}
                      >
                        <input
                          id={`${expensesLabelId}-${expenseIndex}-date`}
                          type="date"
                          className={inputClass}
                          value={expense.expenseDate}
                          readOnly={readOnly}
                          onChange={(event) =>
                            updateExpense(expenseIndex, { expenseDate: event.target.value })
                          }
                        />
                      </FormField>
                      <FormField
                        label="Amount"
                        htmlFor={`${expensesLabelId}-${expenseIndex}-amount`}
                        required
                        tone={tone}
                        error={errors[`expenses.${expenseIndex}.amountMinor`]}
                      >
                        <input
                          id={`${expensesLabelId}-${expenseIndex}-amount`}
                          inputMode="decimal"
                          className={inputClass}
                          value={expense.amount}
                          readOnly={readOnly}
                          onChange={(event) =>
                            updateExpense(expenseIndex, { amount: event.target.value })
                          }
                        />
                      </FormField>
                      <FormField
                        label="Currency"
                        htmlFor={`${expensesLabelId}-${expenseIndex}-currency`}
                        required
                        tone={tone}
                      >
                        <ChoiceInput
                          inputId={`${expensesLabelId}-${expenseIndex}-currency`}
                          layout="popover"
                          value={expense.currency}
                          disabled={readOnly}
                          onChange={(value) => {
                            const next = Array.isArray(value) ? value[0] : value;
                            updateExpense(expenseIndex, {
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
                    </div>
                    {expense.currency === 'other' ? (
                      <FormField
                        label="Other currency"
                        htmlFor={`${expensesLabelId}-${expenseIndex}-currency-other`}
                        required
                        tone={tone}
                        error={errors[`expenses.${expenseIndex}.currencyOther`]}
                      >
                        <input
                          id={`${expensesLabelId}-${expenseIndex}-currency-other`}
                          className={inputClass}
                          value={expense.currencyOther}
                          readOnly={readOnly}
                          onChange={(event) =>
                            updateExpense(expenseIndex, { currencyOther: event.target.value })
                          }
                        />
                      </FormField>
                    ) : null}
                    <div className="flex items-start gap-2">
                      <div className="flex-1">
                        <FormCheckbox
                          tone={tone}
                          disabled={durableDisabled}
                          checked={expense.includesDurableGood}
                          onChange={(checked) =>
                            updateExpense(expenseIndex, { includesDurableGood: checked })
                          }
                          label="This expense includes a durable good"
                          helperText={
                            durableDisabled && !readOnly
                              ? 'Available for expenses of $200 or more.'
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
                    {errors[`expenses.${expenseIndex}.includesDurableGood`] ? (
                      <FormFieldMessage tone={tone} intent="error">
                        {errors[`expenses.${expenseIndex}.includesDurableGood`]}
                      </FormFieldMessage>
                    ) : null}

                    <div className="space-y-4 border-l-4 border-primary-teal/30 pl-4">
                      <FormField
                        label="Receipt"
                        labelId={receiptChoiceLabelId}
                        required
                        tone={tone}
                        error={errors[`expenses.${expenseIndex}.documents`]}
                      >
                        <ChoiceInput
                          layout="inline"
                          ariaLabelledBy={receiptChoiceLabelId}
                          value={expense.noReceipt ? 'missing' : 'attached'}
                          disabled={readOnly}
                          onChange={(value) => {
                            const next = Array.isArray(value) ? value[0] : value;
                            setNoReceipt(expenseIndex, next === 'missing');
                          }}
                          options={[
                            { value: 'attached', label: 'I have a receipt' },
                            { value: 'missing', label: 'I do not have a receipt' },
                          ]}
                        />
                      </FormField>
                      {expense.noReceipt ? (
                        <FormField
                          label="Why is there no receipt?"
                          htmlFor={`${expensesLabelId}-${expenseIndex}-no-receipt`}
                          required
                          tone={tone}
                          error={errors[`expenses.${expenseIndex}.noReceiptExplanation`]}
                        >
                          <textarea
                            id={`${expensesLabelId}-${expenseIndex}-no-receipt`}
                            className={inputClass}
                            rows={2}
                            value={expense.noReceiptExplanation}
                            readOnly={readOnly}
                            onChange={(event) =>
                              updateExpense(expenseIndex, {
                                noReceiptExplanation: event.target.value,
                              })
                            }
                          />
                        </FormField>
                      ) : receipt ? (
                        <FormField
                          label="Receipt file"
                          htmlFor={readOnly ? undefined : `${expensesLabelId}-${expenseIndex}-receipt-file`}
                          required={!receipt.id && !readOnly}
                          tone={tone}
                          error={errors[`expenses.${expenseIndex}.documents.${receiptIndex}.file`]}
                          helperText={
                            receipt.existingFilename && !receipt.file
                              ? `Current file: ${receipt.existingFilename}`
                              : readOnly
                                ? undefined
                                : 'PDF, JPEG, PNG, WebP, or HEIC; up to 10 MB.'
                          }
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            {!readOnly ? (
                              <input
                                id={`${expensesLabelId}-${expenseIndex}-receipt-file`}
                                type="file"
                                className={`${inputClass} min-w-0 flex-1`}
                                accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
                                onChange={(event) =>
                                  updateDocument(expenseIndex, receiptIndex, {
                                    file: event.target.files?.[0] ?? null,
                                  })
                                }
                              />
                            ) : (
                              <p className="min-w-0 flex-1 text-sm text-gray-700 dark:text-gray-300">
                                {receipt.existingFilename}
                              </p>
                            )}
                            {showExistingReceiptActions &&
                            receipt.id &&
                            documentFilePath &&
                            receipt.existingFilename ? (
                              <Button
                                type="button"
                                variant="secondary"
                                onClick={() => void openExpenseReceipt(documentFilePath(receipt.id!))}
                              >
                                View receipt
                              </Button>
                            ) : null}
                          </div>
                        </FormField>
                      ) : null}
                    </div>

                    <div className="space-y-3">
                      <div>
                        <h5 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          Other supporting documents
                        </h5>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          Optional invoices or other supporting evidence for this expense.
                        </p>
                      </div>
                      {supportingDocuments.map(({ document, documentIndex }) => (
                        <div
                          key={document.key}
                          className="grid items-start gap-3 border-t border-gray-200 pt-3 sm:grid-cols-[12rem_minmax(0,1fr)] dark:border-gray-700"
                        >
                          <FormField
                            label="Document type"
                            htmlFor={`${expensesLabelId}-${expenseIndex}-document-${documentIndex}-type`}
                            required
                            tone={tone}
                            error={errors[`expenses.${expenseIndex}.documents.${documentIndex}.documentType`]}
                          >
                            <ChoiceInput
                              inputId={`${expensesLabelId}-${expenseIndex}-document-${documentIndex}-type`}
                              layout="popover"
                              value={document.documentType}
                              disabled={readOnly}
                              onChange={(value) => {
                                const next = Array.isArray(value) ? value[0] : value;
                                updateDocument(expenseIndex, documentIndex, {
                                  documentType:
                                    next === 'other_supporting_evidence'
                                      ? 'other_supporting_evidence'
                                      : 'invoice',
                                });
                              }}
                              options={[
                                { value: 'invoice', label: 'Invoice' },
                                {
                                  value: 'other_supporting_evidence',
                                  label: 'Other supporting evidence',
                                },
                              ]}
                            />
                          </FormField>
                          {!readOnly ? (
                            <FormField
                              label="File"
                              htmlFor={`${expensesLabelId}-${expenseIndex}-document-${documentIndex}-file`}
                              required={!document.id}
                              tone={tone}
                              error={errors[`expenses.${expenseIndex}.documents.${documentIndex}.file`]}
                              helperText={
                                document.existingFilename && !document.file
                                  ? `Current file: ${document.existingFilename}`
                                  : undefined
                              }
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <input
                                  id={`${expensesLabelId}-${expenseIndex}-document-${documentIndex}-file`}
                                  type="file"
                                  className={`${inputClass} min-w-0 flex-1`}
                                  accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
                                  onChange={(event) =>
                                    updateDocument(expenseIndex, documentIndex, {
                                      file: event.target.files?.[0] ?? null,
                                    })
                                  }
                                />
                                {showExistingReceiptActions &&
                                document.id &&
                                documentFilePath &&
                                document.existingFilename ? (
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={() => void openExpenseReceipt(documentFilePath(document.id!))}
                                  >
                                    View
                                  </Button>
                                ) : null}
                                <Button
                                  type="button"
                                  variant="secondary"
                                  onClick={() => removeDocument(expenseIndex, documentIndex)}
                                >
                                  Remove
                                </Button>
                              </div>
                            </FormField>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2 pt-7">
                              <p className="text-sm text-gray-700 dark:text-gray-300">
                                {document.existingFilename}
                              </p>
                              {showExistingReceiptActions &&
                              document.id &&
                              documentFilePath &&
                              document.existingFilename ? (
                                <Button
                                  type="button"
                                  variant="secondary"
                                  onClick={() => void openExpenseReceipt(documentFilePath(document.id!))}
                                >
                                  View
                                </Button>
                              ) : null}
                            </div>
                          )}
                        </div>
                      ))}
                      {!readOnly && documentCount < MAX_EXPENSE_DOCUMENTS ? (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() =>
                            updateExpense(expenseIndex, {
                              documents: [...expense.documents, emptyDocument('invoice')],
                            })
                          }
                        >
                          Add supporting document
                        </Button>
                      ) : null}
                    </div>
                    </div>
                    </MobileNavAccordionPanel>
                  </section>
                );
              })}
              {!readOnly && expenses.length < MAX_EXPENSE_ITEMS ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={addExpense}
                >
                  Add another expense
                </Button>
              ) : null}
            </div>
          </FormSection>

          <FormSection tone={tone} title="Reimbursement">
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
                {chargedToClubCard ? (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    No reimbursement is requested because this was charged to a club credit card.
                  </p>
                ) : null}
              </>
            ) : null}
            {showReimbursementRequest ? (
              <>
            <FormField
              label="Total reimbursement requested"
              htmlFor={totalId}
              required
              tone={tone}
              error={errors.requestedAmountMinor}
              helperText={
                mixedCurrencies
                  ? 'Expenses use more than one currency. Enter the USD amount to reimburse and explain the difference.'
                  : 'Defaults to the sum of the expenses. Edit if needed and explain any difference.'
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
                  setRequestedTouched(mixedCurrencies || dollarsToMinor(next) !== expenseSumMinor);
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
              </>
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
          <FormField label="Any additional comments about this expense report?" htmlFor={commentsId} optional tone={tone}>
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

      {!readOnly && showSubmitButton ? (
        <div className="flex justify-end">
          <Button type="submit" disabled={submitting || !kind}>
            {submitting ? 'Submitting…' : submitLabel}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
