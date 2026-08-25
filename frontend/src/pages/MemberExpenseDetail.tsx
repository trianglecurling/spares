import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { get } from '../api/client';
import { AppPage, AppPageHeader } from '../components/AppPage';
import AppStateCard from '../components/AppStateCard';
import BackButton from '../components/BackButton';
import ExpenseReportForm, { type ExpenseFieldError, type ExpenseFormOptions } from '../components/ExpenseReportForm';
import InlineStateMessage from '../components/InlineStateMessage';
import { useAlert } from '../contexts/AlertContext';
import api, { formatApiError } from '../utils/api';
import { emptyStructuredPostalAddress } from '../utils/structuredPostalAddress';
import { FINANCE_CONTACT_EMAIL, type ExpenseReportView } from '../utils/expenseReports';
import { fieldErrorsFromUnknown, postExpenseFormData } from '../utils/expenseReportSubmit';

export default function MemberExpenseDetail() {
  const { id } = useParams<{ id: string }>();
  const reportId = Number.parseInt(id ?? '', 10);
  const { showAlert } = useAlert();
  const [options, setOptions] = useState<ExpenseFormOptions | null>(null);
  const [report, setReport] = useState<ExpenseReportView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ExpenseFieldError[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(reportId)) return;
    setLoading(true);
    setError(null);
    try {
      const [optionsRes, reportRes] = await Promise.all([
        api.get<ExpenseFormOptions>('/public/expenses/form-options'),
        get('/expenses/{id}', undefined, { id: String(reportId) }),
      ]);
      setOptions(optionsRes.data);
      setReport(reportRes as ExpenseReportView);
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
    return <Navigate to="/expenses" replace />;
  }

  return (
    <AppPage narrow>
      <BackButton label="Back to expense reports" to="/expenses" />
      <AppPageHeader
        title={report?.canEdit ? 'Edit expense report' : 'Expense report'}
        description={report ? `Status: ${report.statusLabel}` : undefined}
      />
      {loading ? (
        <AppStateCard title="Loading" description="Loading this expense report." />
      ) : error || !report || !options ? (
        <AppStateCard
          title="Could not load report"
          description={error ?? 'This report was not found.'}
          action={
            <Link to="/expenses" className="text-primary-teal-link hover:underline">
              Return to expense reports
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {!report.canEdit ? (
            <InlineStateMessage
              tone="warning"
              title={
                <>
                  If you need to change this expense report, please email{' '}
                  <a href={`mailto:${FINANCE_CONTACT_EMAIL}`} className="font-medium underline">
                    {FINANCE_CONTACT_EMAIL}
                  </a>
                </>
              }
            />
          ) : null}
          <div className="app-card p-6">
            <ExpenseReportForm
              tone="app"
              readOnly={!report.canEdit}
              formOptions={options}
              identity={{
                name: report.submitterName,
                email: report.submitterEmail,
                phone: report.submitterPhone ?? '',
                mailingAddress: report.mailingAddress ?? emptyStructuredPostalAddress(),
              }}
              initialReport={report}
              fieldErrors={fieldErrors}
              submitting={submitting}
              submitLabel="Save changes"
              receiptFilePath={(receiptId) => `/expenses/${reportId}/receipts/${receiptId}`}
              onSubmit={async ({ payload, files }) => {
                setSubmitting(true);
                setFieldErrors([]);
                try {
                  const response = await postExpenseFormData(`/expenses/${reportId}`, payload, files, 'patch');
                  setReport(response.data as ExpenseReportView);
                  showAlert('Expense report updated.', 'success');
                } catch (err) {
                  setFieldErrors(fieldErrorsFromUnknown(err));
                  showAlert(formatApiError(err, 'Could not update the expense report.'), 'error');
                } finally {
                  setSubmitting(false);
                }
              }}
            />
          </div>
        </div>
      )}
    </AppPage>
  );
}
