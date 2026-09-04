import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ExpenseReportForm, { type ExpenseFieldError } from '../components/ExpenseReportForm';
import InlineStateMessage from '../components/InlineStateMessage';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import SeoMeta from '../components/SeoMeta';
import { useAlert } from '../contexts/AlertContext';
import api, { formatApiError } from '../utils/api';
import { emptyStructuredPostalAddress } from '../utils/structuredPostalAddress';
import { FINANCE_CONTACT_EMAIL, type ExpenseReportView } from '../utils/expenseReports';
import { fieldErrorsFromUnknown, postExpenseFormData } from '../utils/expenseReportSubmit';
import type { FormOptionsResponse } from './PublicExpenseReportPage';

export default function PublicExpenseReportManagePage() {
  const { accessToken } = useParams<{ accessToken: string }>();
  const { showAlert } = useAlert();
  const [options, setOptions] = useState<FormOptionsResponse | null>(null);
  const [report, setReport] = useState<ExpenseReportView | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<ExpenseFieldError[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!accessToken) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [optionsRes, reportRes] = await Promise.all([
        api.get<FormOptionsResponse>('/public/expenses/form-options'),
        api.get<ExpenseReportView>(`/public/expenses/manage/${encodeURIComponent(accessToken)}`),
      ]);
      setOptions(optionsRes.data);
      setReport(reportRes.data);
      setNotFound(false);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        setNotFound(true);
        setReport(null);
      } else {
        showAlert(formatApiError(err, 'Failed to load this expense report'), 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [accessToken, showAlert]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <PublicLayout>
        <SeoMeta title="Expense report" />
        <PublicStateCard title="Loading" description="Loading this expense report." />
      </PublicLayout>
    );
  }

  if (notFound || !report || !options) {
    return (
      <PublicLayout>
        <SeoMeta title="Expense report not found" />
        <PublicStateCard
          tone="error"
          title="Report not found"
          description="This link is invalid or the report is no longer available."
          action={
            <Link to="/expenses/new" className="text-primary-teal-link hover:underline">
              Submit an expense report
            </Link>
          }
        />
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <SeoMeta title="Expense report" />
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <p className="mb-2 text-sm text-gray-500">Status: {report.statusLabel}</p>
        <h1 className="mb-6 text-3xl font-semibold tracking-tight text-gray-900">
          {report.canEdit ? 'Update expense report' : 'View expense report'}
        </h1>
        {!report.canEdit ? (
          <div className="mb-6">
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
          </div>
        ) : null}
        <div className="public-card p-6 sm:p-7">
          <ExpenseReportForm
            tone="public"
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
            documentFilePath={(documentId) =>
              `/public/expenses/manage/${encodeURIComponent(accessToken ?? '')}/receipts/${documentId}`
            }
            onSubmit={async ({ payload, files }) => {
              if (!accessToken) return;
              setSubmitting(true);
              setFieldErrors([]);
              try {
                const response = await postExpenseFormData(
                  `/public/expenses/manage/${encodeURIComponent(accessToken)}`,
                  payload,
                  files,
                  'patch'
                );
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
    </PublicLayout>
  );
}
