import { FormEvent, useCallback, useEffect, useId, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { get, patch, post } from '../../api/client';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppStateCard from '../../components/AppStateCard';
import BackButton from '../../components/BackButton';
import Button from '../../components/Button';
import ChoiceInput from '../../components/ChoiceInput';
import ExpenseReportForm, { type ExpenseFieldError, type ExpenseFormOptions } from '../../components/ExpenseReportForm';
import FormField from '../../components/FormField';
import FormSection from '../../components/FormSection';
import InlineStateMessage from '../../components/InlineStateMessage';
import { useAlert } from '../../contexts/AlertContext';
import { useAuth } from '../../contexts/AuthContext';
import { memberHasScope } from '../../utils/permissions';
import api, { formatApiError } from '../../utils/api';
import { emptyStructuredPostalAddress } from '../../utils/structuredPostalAddress';
import {
  EXPENSE_STATUS_OPTIONS,
  formatSubmittedAt,
  type ExpenseReportStatus,
  type ExpenseReportView,
} from '../../utils/expenseReports';
import { fieldErrorsFromUnknown, postExpenseFormData } from '../../utils/expenseReportSubmit';

export default function AdminExpenseDetail() {
  const { id } = useParams<{ id: string }>();
  const reportId = Number.parseInt(id ?? '', 10);
  const { member } = useAuth();
  const { showAlert } = useAlert();
  const statusId = useId();
  const noteId = useId();
  const canManage = memberHasScope(member, 'expenses.manage');
  const [options, setOptions] = useState<ExpenseFormOptions | null>(null);
  const [report, setReport] = useState<ExpenseReportView | null>(null);
  const [status, setStatus] = useState<ExpenseReportStatus>('pending_review');
  const [noteBody, setNoteBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [savingReport, setSavingReport] = useState(false);
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

  if (!id || !/^\d+$/.test(id)) {
    return <Navigate to="/admin/expenses" replace />;
  }

  const handleStatusSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage) return;
    setSavingStatus(true);
    try {
      const updated = await patch('/admin/expenses/{id}', { status }, { id: String(reportId) });
      setReport(updated as ExpenseReportView);
      showAlert('Status updated.', 'success');
    } catch (err) {
      showAlert(formatApiError(err, 'Could not update the status.'), 'error');
    } finally {
      setSavingStatus(false);
    }
  };

  const handleAddNote = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || !noteBody.trim()) return;
    setSavingNote(true);
    try {
      const updated = await post(
        '/admin/expenses/{id}/notes',
        { body: noteBody.trim() },
        { id: String(reportId) }
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

  return (
    <AppPage narrow>
      <BackButton label="Back to expense reports" to="/admin/expenses" />
      <AppPageHeader
        title="Expense report"
        description={report ? `${report.submitterName} · ${report.submitterEmail}` : undefined}
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
        <div className="space-y-6">
          <form onSubmit={handleStatusSave} className="app-card space-y-4 p-6">
            <FormSection title="Staff review">
              <FormField label="Status" htmlFor={statusId} required>
                <ChoiceInput
                  inputId={statusId}
                  layout="popover"
                  value={status}
                  disabled={!canManage}
                  onChange={(value) => {
                    const next = Array.isArray(value) ? value[0] : value;
                    if (EXPENSE_STATUS_OPTIONS.some((option) => option.value === next)) {
                      setStatus(next as ExpenseReportStatus);
                    }
                  }}
                  options={[...EXPENSE_STATUS_OPTIONS]}
                />
              </FormField>
              {report.statusChangedByName || report.statusChangedAt ? (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Status last changed
                  {report.statusChangedByName ? ` by ${report.statusChangedByName}` : ''}
                  {report.statusChangedAt ? ` on ${formatSubmittedAt(report.statusChangedAt)}` : ''}.
                </p>
              ) : null}
              {canManage ? (
                <div className="flex justify-end">
                  <Button type="submit" disabled={savingStatus}>
                    {savingStatus ? 'Saving…' : 'Save status'}
                  </Button>
                </div>
              ) : null}
            </FormSection>
          </form>

          <div className="app-card space-y-4 p-6">
            <FormSection title="Staff notes">
              {(report.notes ?? []).length === 0 ? (
                <InlineStateMessage title="No notes yet" description="Notes stay on this report and cannot be edited after they are added." />
              ) : (
                <ul className="space-y-3">
                  {(report.notes ?? []).map((note) => (
                    <li key={note.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                      <p className="whitespace-pre-wrap text-sm text-gray-900 dark:text-gray-100">{note.body}</p>
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
                      rows={4}
                      value={noteBody}
                      onChange={(event) => setNoteBody(event.target.value)}
                    />
                  </FormField>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={savingNote || !noteBody.trim()}>
                      {savingNote ? 'Adding…' : 'Add note'}
                    </Button>
                  </div>
                </form>
              ) : null}
            </FormSection>
          </div>

          <div className="app-card space-y-4 p-6">
            <FormSection title="Change history">
              {(report.changes ?? []).length === 0 ? (
                <InlineStateMessage title="No changes recorded" description="Staff updates to this report will appear here." />
              ) : (
                <ul className="space-y-3">
                  {(report.changes ?? []).map((change) => (
                    <li key={change.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{change.summary}</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {change.actorName} · {formatSubmittedAt(change.createdAt)}
                      </p>
                      {change.details && change.details.length > 0 && change.kind === 'fields' ? (
                        <ul className="mt-2 space-y-1 text-xs text-gray-600 dark:text-gray-400">
                          {change.details.map((detail) => (
                            <li key={`${change.id}-${detail.field}`}>
                              {detail.field}: {detail.from || 'blank'} → {detail.to || 'blank'}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </FormSection>
          </div>

          <div className="app-card p-6">
            {report.lastUpdatedByName ? (
              <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
                Last updated by {report.lastUpdatedByName} on {formatSubmittedAt(report.updatedAt)}.
              </p>
            ) : null}
            <ExpenseReportForm
              key={report.updatedAt}
              tone="app"
              readOnly={!canManage}
              formOptions={options}
              clubCardMode="staff"
              identity={{
                name: report.submitterName,
                email: report.submitterEmail,
                phone: report.submitterPhone ?? '',
                mailingAddress: report.mailingAddress ?? emptyStructuredPostalAddress(),
              }}
              initialReport={report}
              fieldErrors={fieldErrors}
              submitting={savingReport}
              submitLabel="Save report"
              receiptFilePath={(receiptId) => `/admin/expenses/${reportId}/receipts/${receiptId}`}
              onSubmit={async ({ payload, files }) => {
                if (!canManage) return;
                setSavingReport(true);
                setFieldErrors([]);
                try {
                  const response = await postExpenseFormData(
                    `/admin/expenses/${reportId}/report`,
                    payload,
                    files,
                    'patch'
                  );
                  const updated = response.data as ExpenseReportView;
                  setReport(updated);
                  setStatus((updated.status as ExpenseReportStatus) || status);
                  showAlert('Expense report updated.', 'success');
                } catch (err) {
                  setFieldErrors(fieldErrorsFromUnknown(err));
                  showAlert(formatApiError(err, 'Could not update this expense report.'), 'error');
                } finally {
                  setSavingReport(false);
                }
              }}
            />
          </div>
        </div>
      )}
    </AppPage>
  );
}
