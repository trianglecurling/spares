import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  HiArrowDownTray,
  HiArrowTopRightOnSquare,
  HiChevronDown,
} from 'react-icons/hi2';
import { Link, Navigate, useParams } from 'react-router-dom';
import { get, patch, post } from '../../api/client';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppStateCard from '../../components/AppStateCard';
import BackButton from '../../components/BackButton';
import Button from '../../components/Button';
import ChoiceInput from '../../components/ChoiceInput';
import ExpenseReportForm, {
  type ExpenseFieldError,
  type ExpenseFormOptions,
} from '../../components/ExpenseReportForm';
import FormField from '../../components/FormField';
import InlineStateMessage from '../../components/InlineStateMessage';
import { useAlert } from '../../contexts/AlertContext';
import { useAuth } from '../../contexts/AuthContext';
import api, { formatApiError } from '../../utils/api';
import {
  downloadExpenseReceipt,
  fieldErrorsFromUnknown,
  openExpenseReceipt,
  postExpenseFormData,
} from '../../utils/expenseReportSubmit';
import {
  EXPENSE_STATUS_OPTIONS,
  expenseDocumentTypeLabel,
  expenseKindLabel,
  formatExpenseMoney,
  formatSubmittedAt,
  type ExpenseDocumentView,
  type ExpenseReportStatus,
  type ExpenseReportView,
} from '../../utils/expenseReports';
import { memberHasScope } from '../../utils/permissions';
import { emptyStructuredPostalAddress } from '../../utils/structuredPostalAddress';

const compactActionClass =
  'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-primary-teal-link hover:bg-primary-teal/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40 disabled:cursor-wait disabled:opacity-50';

function statusBadgeClass(status: string): string {
  if (status === 'complete') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-200';
  }
  if (status === 'check_mailed') {
    return 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/70 dark:bg-blue-950/40 dark:text-blue-200';
  }
  if (status === 'processing') {
    return 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-200';
  }
  return 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-300';
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function humanizeToken(value: string | null | undefined): string {
  if (!value) return '';
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function DetailItem({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-[0.7rem] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
        {children || '—'}
      </dd>
    </div>
  );
}

export default function AdminExpenseDetail() {
  const { id } = useParams<{ id: string }>();
  const reportId = Number.parseInt(id ?? '', 10);
  const { member } = useAuth();
  const { showAlert } = useAlert();
  const statusId = useId();
  const noteId = useId();
  const reviewFormId = useId();
  const detailEditorRef = useRef<HTMLDetailsElement>(null);
  const canManage = memberHasScope(member, 'expenses.manage');
  const [options, setOptions] = useState<ExpenseFormOptions | null>(null);
  const [report, setReport] = useState<ExpenseReportView | null>(null);
  const [status, setStatus] = useState<ExpenseReportStatus>('pending_review');
  const [noteBody, setNoteBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [savingReport, setSavingReport] = useState(false);
  const [documentAction, setDocumentAction] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ExpenseFieldError[]>([]);

  const load = useCallback(async () => {
    if (!Number.isFinite(reportId)) return;
    setLoading(true);
    setError(null);
    try {
      const [optionsRes, reportRes] = await Promise.all([
        api.get<ExpenseFormOptions>('/public/expenses/form-options'),
        get('/admin/expenses/{id}', undefined, { id: String(reportId) }),
      ]);
      const loaded = reportRes as ExpenseReportView;
      setOptions(optionsRes.data);
      setReport(loaded);
      setStatus((loaded.status as ExpenseReportStatus) || 'pending_review');
    } catch (err) {
      setError(formatApiError(err, 'Failed to load this expense report'));
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (fieldErrors.length > 0) {
      detailEditorRef.current?.setAttribute('open', '');
    }
  }, [fieldErrors]);

  const expenseTotalMinor = useMemo(
    () => (report?.expenses ?? []).reduce((sum, expense) => sum + expense.amountMinor, 0),
    [report],
  );
  const documentCount = useMemo(
    () =>
      (report?.expenses ?? []).reduce(
        (sum, expense) => sum + expense.documents.length,
        0,
      ),
    [report],
  );

  if (!id || !/^\d+$/.test(id)) {
    return <Navigate to="/admin/expenses" replace />;
  }

  const handleAddNote = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || !noteBody.trim()) return;
    setSavingNote(true);
    try {
      const updated = await post(
        '/admin/expenses/{id}/notes',
        { body: noteBody.trim() },
        { id: String(reportId) },
      );
      setReport(updated as ExpenseReportView);
      setNoteBody('');
      showAlert('Note added.', 'success');
    } catch (err) {
      showAlert(formatApiError(err, 'Could not add the note.'), 'error');
    } finally {
      setSavingNote(false);
    }
  };

  const handleSaveChanges = async ({
    payload,
    files,
  }: {
    payload: Record<string, unknown>;
    files: Array<{ expenseIndex: number; documentIndex: number; file: File }>;
  }) => {
    if (!canManage || !report) return;
    setSavingReport(true);
    setFieldErrors([]);
    try {
      const reportResponse = await postExpenseFormData(
        `/admin/expenses/${reportId}/report`,
        payload,
        files,
        'patch',
      );
      let updated = reportResponse.data as ExpenseReportView;
      if (status !== updated.status) {
        updated = (await patch(
          '/admin/expenses/{id}',
          { status },
          { id: String(reportId) },
        )) as ExpenseReportView;
      }
      setReport(updated);
      setStatus((updated.status as ExpenseReportStatus) || status);
      showAlert('Expense report changes saved.', 'success');
    } catch (err) {
      const nextFieldErrors = fieldErrorsFromUnknown(err);
      setFieldErrors(nextFieldErrors);
      showAlert(formatApiError(err, 'Could not save this expense report.'), 'error');
    } finally {
      setSavingReport(false);
    }
  };

  const handleDocumentAction = async (
    document: ExpenseDocumentView,
    action: 'view' | 'download',
  ) => {
    const actionKey = `${action}-${document.id}`;
    setDocumentAction(actionKey);
    const path = `/admin/expenses/${reportId}/receipts/${document.id}`;
    try {
      if (action === 'view') {
        await openExpenseReceipt(path);
      } else {
        await downloadExpenseReceipt(path, document.originalFilename);
      }
    } catch (err) {
      showAlert(
        formatApiError(
          err,
          action === 'view'
            ? 'Could not open this supporting document.'
            : 'Could not download this supporting document.',
        ),
        'error',
      );
    } finally {
      setDocumentAction(null);
    }
  };

  const statusLabel =
    EXPENSE_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
  const committee = report?.committeeCustom || report?.committeeName || 'Not specified';
  const paymentMethod = report?.usedClubCreditCard
    ? `Club credit card${report.clubCreditCardOwnerName ? ` · ${report.clubCreditCardOwnerName}` : ''}`
    : 'Reimbursement check';
  const amountDiffers = report
    ? !report.usedClubCreditCard &&
      expenseTotalMinor !== report.requestedAmountMinor
    : false;

  return (
    <AppPage className="space-y-5">
      <BackButton label="Expense reports" to="/admin/expenses" />
      <AppPageHeader
        title={report ? `Expense report #${report.id}` : 'Expense report'}
        description={
          report
            ? `Submitted ${formatSubmittedAt(report.submittedAt)} by ${report.submitterName}`
            : undefined
        }
      />

      {loading ? (
        <AppStateCard title="Loading" description="Loading this expense report." />
      ) : error || !report || !options ? (
        <AppStateCard
          title="Could not load report"
          description={error ?? 'This report was not found.'}
          action={
            <Link to="/admin/expenses" className="text-primary-teal-link hover:underline">
              Return to expense reports
            </Link>
          }
        />
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <main className="min-w-0 space-y-5">
            <section className="app-card overflow-hidden p-0">
              <div className="flex flex-col gap-4 border-b border-gray-200 bg-gray-50/70 px-5 py-4 dark:border-gray-700 dark:bg-gray-900/30 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {report.usedClubCreditCard
                      ? 'Reimbursement'
                      : 'Requested reimbursement'}
                  </p>
                  <p className="mt-1 text-3xl font-bold tracking-tight text-[#121033] dark:text-white">
                    {report.usedClubCreditCard
                      ? 'None'
                      : formatExpenseMoney(
                          report.requestedAmountMinor,
                          report.requestedCurrency,
                        )}
                  </p>
                </div>
                <span
                  className={`inline-flex w-fit rounded-full border px-3 py-1 text-sm font-semibold ${statusBadgeClass(report.status)}`}
                >
                  {report.statusLabel}
                </span>
              </div>

              <dl className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
                <DetailItem label="Report type">
                  {expenseKindLabel(report.kind)}
                </DetailItem>
                <DetailItem label="Committee">{committee}</DetailItem>
                <DetailItem label="Payment method">{paymentMethod}</DetailItem>
                <DetailItem label="Submitted">
                  {formatSubmittedAt(report.submittedAt)}
                </DetailItem>
                <DetailItem label="Purpose" className="sm:col-span-2 lg:col-span-4">
                  {report.purpose ||
                    humanizeToken(report.tripPurpose) ||
                    'Not provided'}
                </DetailItem>
                {report.kind === 'mileage' ? (
                  <>
                    <DetailItem label="Activity date">
                      {report.activityDate || '—'}
                    </DetailItem>
                    <DetailItem label="Round trip">
                      {report.roundTripMiles != null
                        ? `${report.roundTripMiles} miles`
                        : '—'}
                    </DetailItem>
                    <DetailItem label="From">
                      {report.fromKind === 'other'
                        ? report.fromOther
                        : humanizeToken(report.fromKind) || '—'}
                    </DetailItem>
                    <DetailItem label="To">
                      {report.toKind === 'other'
                        ? report.toOther
                        : humanizeToken(report.toKind) || '—'}
                    </DetailItem>
                  </>
                ) : null}
                {report.amountJustification ? (
                  <DetailItem
                    label="Amount justification"
                    className="sm:col-span-2 lg:col-span-4"
                  >
                    {report.amountJustification}
                  </DetailItem>
                ) : null}
                {report.comments ? (
                  <DetailItem
                    label="Submitter comments"
                    className="sm:col-span-2 lg:col-span-4"
                  >
                    <span className="whitespace-pre-wrap font-normal">
                      {report.comments}
                    </span>
                  </DetailItem>
                ) : null}
              </dl>
            </section>

            <section className="app-card p-0">
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-200 px-5 py-4 dark:border-gray-700">
                <div>
                  <h2 className="app-section-title text-lg">Expenses and documents</h2>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                    {report.expenses.length}{' '}
                    {report.expenses.length === 1 ? 'expense' : 'expenses'} ·{' '}
                    {documentCount} {documentCount === 1 ? 'document' : 'documents'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Expense total
                  </p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {formatExpenseMoney(expenseTotalMinor, report.requestedCurrency)}
                  </p>
                </div>
              </div>

              {report.expenses.length === 0 ? (
                <div className="p-5">
                  <InlineStateMessage
                    title="No expenses"
                    description="This report does not contain any expenses."
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50/80 text-left dark:bg-gray-900/30">
                      <tr>
                        <th className="px-4 py-2.5 text-xs font-semibold text-gray-600 dark:text-gray-300">
                          Expense
                        </th>
                        <th className="whitespace-nowrap px-4 py-2.5 text-xs font-semibold text-gray-600 dark:text-gray-300">
                          Date
                        </th>
                        <th className="whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold text-gray-600 dark:text-gray-300">
                          Amount
                        </th>
                        <th className="whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold text-gray-600 dark:text-gray-300">
                          Documents and actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700/70">
                      {report.expenses.map((expense) => (
                        <tr key={expense.id}>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-gray-900 dark:text-gray-100">
                                {expense.name}
                              </span>
                              {expense.includesDurableGood ? (
                                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[0.7rem] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                                  Durable good
                                </span>
                              ) : null}
                            </div>
                            {expense.noReceiptExplanation ? (
                              <p className="mt-1 max-w-md text-xs text-amber-700 dark:text-amber-300">
                                No receipt: {expense.noReceiptExplanation}
                              </p>
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                            {expense.expenseDate}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right">
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                              {formatExpenseMoney(expense.amountMinor, expense.currency)}
                            </p>
                          </td>
                          <td className="px-2 py-3">
                            {expense.documents.length === 0 ? (
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                No files
                              </span>
                            ) : (
                              <ul className="space-y-1.5">
                                {expense.documents.map((document) => (
                                  <li
                                    key={document.id}
                                    className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2"
                                  >
                                    <span className="min-w-0 break-all text-xs text-gray-600 dark:text-gray-300">
                                      {expenseDocumentTypeLabel(document.documentType)} ·{' '}
                                      {document.originalFilename} · {formatBytes(document.byteSize)}
                                    </span>
                                    <div className="flex shrink-0 items-center justify-end gap-1">
                                    <button
                                      type="button"
                                      className={compactActionClass}
                                      disabled={documentAction !== null}
                                      onClick={() => void handleDocumentAction(document, 'view')}
                                    >
                                      <HiArrowTopRightOnSquare className="h-4 w-4" aria-hidden />
                                      {documentAction === `view-${document.id}` ? 'Opening…' : 'View'}
                                    </button>
                                    <button
                                      type="button"
                                      className={compactActionClass}
                                      disabled={documentAction !== null}
                                      onClick={() => void handleDocumentAction(document, 'download')}
                                    >
                                      <HiArrowDownTray className="h-4 w-4" aria-hidden />
                                      {documentAction === `download-${document.id}`
                                        ? 'Downloading…'
                                        : 'Download'}
                                    </button>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {amountDiffers ? (
                <div className="border-t border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
                  Requested reimbursement differs from the expense total by{' '}
                  <strong>
                    {formatExpenseMoney(
                      report.requestedAmountMinor - expenseTotalMinor,
                      report.requestedCurrency,
                    )}
                  </strong>
                  .
                </div>
              ) : null}
            </section>

            <details
              ref={detailEditorRef}
              className="group app-card p-0"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-semibold text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-teal/40 dark:text-gray-100 [&::-webkit-details-marker]:hidden">
                <span>
                  Edit report details
                  <span className="ml-2 font-normal text-gray-500 dark:text-gray-400">
                    Change reimbursement, submitter, or document information
                  </span>
                </span>
                <HiChevronDown
                  className="h-5 w-5 shrink-0 transition-transform group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <div className="border-t border-gray-200 p-5 dark:border-gray-700">
                {report.lastUpdatedByName ? (
                  <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
                    Last updated by {report.lastUpdatedByName} on{' '}
                    {formatSubmittedAt(report.updatedAt)}.
                  </p>
                ) : null}
                <ExpenseReportForm
                  key={report.updatedAt}
                  formId={reviewFormId}
                  density="compact"
                  showSubmitButton={false}
                  showExistingReceiptActions={false}
                  tone="app"
                  readOnly={!canManage}
                  formOptions={options}
                  clubCardMode="staff"
                  identity={{
                    name: report.submitterName,
                    email: report.submitterEmail,
                    phone: report.submitterPhone ?? '',
                    mailingAddress:
                      report.mailingAddress ?? emptyStructuredPostalAddress(),
                  }}
                  initialReport={report}
                  fieldErrors={fieldErrors}
                  submitting={savingReport}
                  documentFilePath={(documentId) =>
                    `/admin/expenses/${reportId}/receipts/${documentId}`
                  }
                  onSubmit={handleSaveChanges}
                />
              </div>
            </details>

            <details className="group app-card p-0">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-semibold text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-teal/40 dark:text-gray-100 [&::-webkit-details-marker]:hidden">
                <span>
                  Change history
                  <span className="ml-2 font-normal text-gray-500 dark:text-gray-400">
                    {(report.changes ?? []).length}{' '}
                    {(report.changes ?? []).length === 1 ? 'entry' : 'entries'}
                  </span>
                </span>
                <HiChevronDown
                  className="h-5 w-5 shrink-0 transition-transform group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <div className="border-t border-gray-200 p-5 dark:border-gray-700">
                {(report.changes ?? []).length === 0 ? (
                  <InlineStateMessage
                    title="No changes recorded"
                    description="Staff updates to this report will appear here."
                  />
                ) : (
                  <ol className="min-w-0 divide-y divide-gray-200 dark:divide-gray-700">
                    {(report.changes ?? []).map((change) => (
                      <li key={change.id} className="min-w-0 py-3 first:pt-0 last:pb-0">
                        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
                          <p className="min-w-0 break-all text-sm font-medium text-gray-900 dark:text-gray-100">
                            {change.summary}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {change.actorName} · {formatSubmittedAt(change.createdAt)}
                          </p>
                        </div>
                        {change.details &&
                        change.details.length > 0 &&
                        change.kind === 'fields' ? (
                          <ul className="mt-2 grid min-w-0 gap-1 text-xs text-gray-600 dark:text-gray-400 lg:grid-cols-2">
                            {change.details.map((detail) => (
                              <li
                                key={`${change.id}-${detail.field}`}
                                className="min-w-0 break-all"
                              >
                                <span className="font-medium">{detail.field}:</span>{' '}
                                {detail.from || 'blank'} → {detail.to || 'blank'}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </details>
          </main>

          <aside className="space-y-5 xl:sticky xl:top-4">
            <section className="app-card space-y-4">
              <div>
                <h2 className="app-section-title text-lg">Review</h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  Update the report and its workflow status together.
                </p>
              </div>
              <FormField label="Status" htmlFor={statusId} required>
                <ChoiceInput
                  inputId={statusId}
                  layout="popover"
                  value={status}
                  disabled={!canManage || savingReport}
                  onChange={(value) => {
                    const next = Array.isArray(value) ? value[0] : value;
                    if (
                      EXPENSE_STATUS_OPTIONS.some(
                        (option) => option.value === next,
                      )
                    ) {
                      setStatus(next as ExpenseReportStatus);
                    }
                  }}
                  options={[...EXPENSE_STATUS_OPTIONS]}
                />
              </FormField>
              {status !== report.status ? (
                <InlineStateMessage
                  title={`Ready to change status to ${statusLabel}`}
                  description="This change will be included when you save."
                  tone="warning"
                />
              ) : null}
              {report.statusChangedByName || report.statusChangedAt ? (
                <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                  Last changed
                  {report.statusChangedByName
                    ? ` by ${report.statusChangedByName}`
                    : ''}
                  {report.statusChangedAt
                    ? ` on ${formatSubmittedAt(report.statusChangedAt)}`
                    : ''}
                  .
                </p>
              ) : null}
              {canManage ? (
                <Button
                  type="submit"
                  form={reviewFormId}
                  className="w-full"
                  disabled={savingReport}
                >
                  {savingReport ? 'Saving changes…' : 'Save changes'}
                </Button>
              ) : (
                <InlineStateMessage
                  title="Read-only access"
                  description="You can review and download this report, but cannot change it."
                />
              )}
            </section>

            <section className="app-card space-y-4">
              <div>
                <h2 className="app-section-title text-lg">Staff notes</h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  Internal notes are permanent after they are added.
                </p>
              </div>
              {(report.notes ?? []).length === 0 ? (
                <InlineStateMessage title="No notes yet" />
              ) : (
                <ul className="max-h-52 space-y-3 overflow-y-auto pr-1">
                  {(report.notes ?? []).map((note) => (
                    <li
                      key={note.id}
                      className="rounded-lg border border-gray-200 bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-900/30"
                    >
                      <p className="whitespace-pre-wrap text-sm text-gray-900 dark:text-gray-100">
                        {note.body}
                      </p>
                      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        {note.authorName} · {formatSubmittedAt(note.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {canManage ? (
                <form onSubmit={handleAddNote} className="space-y-3">
                  <FormField label="Add a note" htmlFor={noteId}>
                    <textarea
                      id={noteId}
                      className="app-input"
                      rows={2}
                      value={noteBody}
                      onChange={(event) => setNoteBody(event.target.value)}
                    />
                  </FormField>
                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      variant="secondary"
                      disabled={savingNote || !noteBody.trim()}
                    >
                      {savingNote ? 'Adding…' : 'Add note'}
                    </Button>
                  </div>
                </form>
              ) : null}
            </section>
          </aside>
        </div>
      )}
    </AppPage>
  );
}
