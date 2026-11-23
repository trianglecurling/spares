import { useId, useState } from 'react';
import { post } from '../api/client';
import ConfirmDialog from './ConfirmDialog';
import FormField from './FormField';
import { useAlert } from '../contexts/AlertContext';
import { formatApiError } from '../utils/api';
import {
  expenseKindLabel,
  formatExpenseMoney,
  formatSubmittedAt,
  type ReimbursementCheckPreview,
} from '../utils/expenseReports';

function formatCheckAddress(address: ReimbursementCheckPreview['payeeAddress']): string {
  if (!address) return 'No address on file';
  const line = (value?: string) => value?.trim() ?? '';
  const cityLine = [line(address.city), [line(address.state), line(address.postalCode)].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  const lines = [line(address.addressLine1), line(address.addressLine2), cityLine, line(address.country)].filter(Boolean);
  return lines.length > 0 ? lines.join('\n') : 'No address on file';
}

export function IssueReimbursementCheckDialog({
  preview,
  checkNumber,
  checkNumberError,
  issuing,
  onCheckNumberChange,
  onConfirm,
  onCancel,
}: {
  preview: ReimbursementCheckPreview | null;
  checkNumber: string;
  checkNumberError: string | null;
  issuing: boolean;
  onCheckNumberChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const checkNumberId = useId();
  const reportsHeadingId = useId();
  const payeeHeadingId = useId();

  return (
    <ConfirmDialog
      isOpen={preview != null}
      title="Issue reimbursement check"
      message="Review the check, then enter the check number."
      confirmText={issuing ? 'Issuing check…' : 'Issue check'}
      cancelText="Cancel"
      variant="info"
      panelClassName="max-w-lg"
      confirmDisabled={issuing || checkNumber.trim() === ''}
      initialFocusId={checkNumberId}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {preview ? (
        <div className="space-y-4 text-sm text-gray-800 dark:text-gray-200">
          <div role="group" aria-labelledby={reportsHeadingId}>
            <h4 id={reportsHeadingId} className="app-section-title">
              Reports
            </h4>
            <ul className="mt-2 space-y-2">
              {preview.reports.map((report) => (
                <li key={report.id} className="rounded-md border border-gray-200 px-3 py-2 dark:border-gray-700">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">
                      {expenseKindLabel(report.kind)} report {report.id}
                    </span>
                    <span className="whitespace-nowrap">
                      {formatExpenseMoney(report.amountMinor, report.currency)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Submitted {formatSubmittedAt(report.submittedAt)}
                    {report.description ? ` · ${report.description}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          </div>
          <p>
            <span className="font-medium">Check amount: </span>
            {formatExpenseMoney(preview.amountMinor, preview.currency)}
          </p>
          <div role="group" aria-labelledby={payeeHeadingId}>
            <h4 id={payeeHeadingId} className="app-section-title">
              Made out to
            </h4>
            <p className="mt-2 font-medium">{preview.payeeName}</p>
            <p>{preview.payeePhone?.trim() || 'No phone number on file'}</p>
            <p className="whitespace-pre-line">{formatCheckAddress(preview.payeeAddress)}</p>
          </div>
          <FormField label="Check number" htmlFor={checkNumberId} required error={checkNumberError}>
            {({ describedBy, invalid }) => (
              <input
                id={checkNumberId}
                className="app-input"
                value={checkNumber}
                autoComplete="off"
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                disabled={issuing}
                onChange={(event) => onCheckNumberChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onConfirm();
                  }
                }}
              />
            )}
          </FormField>
        </div>
      ) : null}
    </ConfirmDialog>
  );
}

export function useIssueReimbursementCheck(onIssued: () => void) {
  const { showAlert } = useAlert();
  const [preview, setPreview] = useState<ReimbursementCheckPreview | null>(null);
  const [reportIds, setReportIds] = useState<number[]>([]);
  const [checkNumber, setCheckNumber] = useState('');
  const [checkNumberError, setCheckNumberError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [issuing, setIssuing] = useState(false);

  const start = async (ids: number[]) => {
    if (ids.length === 0 || preparing || issuing) return;
    setPreparing(true);
    try {
      const nextPreview = await post('/admin/expenses/checks/preview', { ids });
      setReportIds(ids);
      setPreview(nextPreview);
      setCheckNumber('');
      setCheckNumberError(null);
    } catch (err) {
      showAlert(formatApiError(err, 'Unable to preview this reimbursement check.'), 'error');
    } finally {
      setPreparing(false);
    }
  };

  const cancel = () => {
    if (issuing) return;
    setPreview(null);
    setCheckNumberError(null);
  };

  const confirm = async () => {
    const trimmed = checkNumber.trim();
    if (!trimmed) {
      setCheckNumberError('Enter the check number.');
      return;
    }
    if (issuing) return;
    setIssuing(true);
    setCheckNumberError(null);
    try {
      const result = await post('/admin/expenses/checks', { ids: reportIds, checkNumber: trimmed });
      if (result.emailSent) {
        showAlert(`Issued check ${result.checkNumber} and emailed ${result.payeeName}.`, 'success');
      } else {
        showAlert(
          `Issued check ${result.checkNumber} for ${result.payeeName}, but the confirmation email could not be sent.`,
          'warning'
        );
      }
      setPreview(null);
      onIssued();
    } catch (err) {
      showAlert(formatApiError(err, 'Unable to issue a reimbursement check.'), 'error');
    } finally {
      setIssuing(false);
    }
  };

  return {
    preparing,
    issuing,
    start,
    preview,
    checkNumber,
    checkNumberError,
    setCheckNumber: (value: string) => {
      setCheckNumber(value);
      setCheckNumberError(null);
    },
    cancel,
    confirm,
  };
}
