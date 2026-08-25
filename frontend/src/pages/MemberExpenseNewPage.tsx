import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppPage, AppPageHeader } from '../components/AppPage';
import AppStateCard from '../components/AppStateCard';
import BackButton from '../components/BackButton';
import Button from '../components/Button';
import ExpenseReportForm, { type ExpenseFieldError } from '../components/ExpenseReportForm';
import { useAlert } from '../contexts/AlertContext';
import { useAuth } from '../contexts/AuthContext';
import api, { formatApiError } from '../utils/api';
import { fieldErrorsFromUnknown, postExpenseFormData } from '../utils/expenseReportSubmit';
import { emptyStructuredPostalAddress } from '../utils/structuredPostalAddress';
import type { FormOptionsResponse } from './PublicExpenseReportPage';

export default function MemberExpenseNewPage() {
  const { member } = useAuth();
  const { showAlert } = useAlert();
  const [options, setOptions] = useState<FormOptionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<ExpenseFieldError[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formResetKey, setFormResetKey] = useState(0);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const response = await api.get<FormOptionsResponse>('/public/expenses/form-options');
        setOptions(response.data);
      } catch (err) {
        showAlert(formatApiError(err, 'Failed to load expense form'), 'error');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [member?.id, showAlert]);

  const identity = {
    name: member?.name || options?.submitterPrefill?.name || '',
    email: member?.email || options?.submitterPrefill?.email || '',
    phone: member?.phone || options?.submitterPrefill?.phone || '',
    mailingAddress:
      options?.submitterPrefill?.mailingAddress ?? emptyStructuredPostalAddress(),
  };

  return (
    <AppPage narrow>
      <BackButton label="Back to expense reports" to="/expenses" />
      <AppPageHeader
        title="Submit an expense report"
        description="Volunteers can request expense or mileage reimbursement. A confirmation email with a private link will be sent after you submit."
      />
      {loading || !options ? (
        <AppStateCard title="Loading" description="Loading the expense form." />
      ) : submitted ? (
        <AppStateCard
          title="Report submitted"
          description="A confirmation email is on the way, including a private link to view or update this report."
          action={
            <div className="flex flex-wrap gap-3">
              <Link to="/expenses" className="text-primary-teal-link hover:underline">
                View your expense reports
              </Link>
              <Button
                type="button"
                onClick={() => {
                  setFieldErrors([]);
                  setFormResetKey((key) => key + 1);
                  setSubmitted(false);
                }}
              >
                Submit another expense
              </Button>
            </div>
          }
        />
      ) : (
        <div className="app-card p-6">
          <ExpenseReportForm
            key={formResetKey}
            tone="app"
            formOptions={options}
            identity={identity}
            fieldErrors={fieldErrors}
            submitting={submitting}
            onSubmit={async ({ payload, files }) => {
              setSubmitting(true);
              setFieldErrors([]);
              try {
                await postExpenseFormData('/public/expenses', payload, files);
                setSubmitted(true);
              } catch (err) {
                setFieldErrors(fieldErrorsFromUnknown(err));
                showAlert(formatApiError(err, 'Could not submit the expense report.'), 'error');
              } finally {
                setSubmitting(false);
              }
            }}
          />
        </div>
      )}
    </AppPage>
  );
}
