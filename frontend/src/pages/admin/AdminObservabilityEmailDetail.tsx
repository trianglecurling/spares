import { useEffect, useId, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppStateCard from '../../components/AppStateCard';
import BackButton from '../../components/BackButton';
import { get } from '../../api/client';
import { getApiErrorMessage } from '../../utils/api';

type OutboundEmailDetail = {
  id: number;
  recipientEmail: string;
  recipientName: string | null;
  subject: string;
  createdAt: string;
  htmlBody: string;
  textBody: string | null;
};

function formatSentAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function AdminObservabilityEmailDetail() {
  const { id } = useParams<{ id: string }>();
  const previewTitleId = useId();
  const [email, setEmail] = useState<OutboundEmailDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!id || !/^\d+$/.test(id)) return;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await get('/observability/emails/{id}', undefined, { id });
        if (!cancelled) setEmail(response);
      } catch (caught) {
        if (!cancelled) {
          setEmail(null);
          setError(getApiErrorMessage(caught, 'Could not load this email'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!id || !/^\d+$/.test(id)) {
    return <Navigate to="/admin/observability/emails" replace />;
  }

  return (
    <AppPage>
      <AppPageHeader
        title={email?.subject ?? 'Sent email'}
        documentTitle="Sent email"
        actions={<BackButton label="Sent emails" to="/admin/observability/emails" />}
      />

      {loading ? <AppStateCard title="Loading email..." /> : null}

      {!loading && (error || !email) ? (
        <AppStateCard
          title="Unable to load email"
          description={error ?? 'This email was not found.'}
          action={
            <Link to="/admin/observability/emails" className="text-primary-teal-link hover:underline">
              Return to sent emails
            </Link>
          }
        />
      ) : null}

      {!loading && !error && email ? (
        <div className="space-y-6">
          <dl className="app-card grid gap-4 p-6 sm:grid-cols-2">
            <div>
              <dt className="app-label">Recipient</dt>
              <dd className="text-sm text-gray-900 dark:text-gray-100">
                {email.recipientEmail}
                {email.recipientName ? (
                  <div className="text-gray-500 dark:text-gray-400">{email.recipientName}</div>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="app-label">Sent</dt>
              <dd className="text-sm text-gray-900 dark:text-gray-100">{formatSentAt(email.createdAt)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="app-label">Subject</dt>
              <dd className="text-sm text-gray-900 dark:text-gray-100">{email.subject}</dd>
            </div>
          </dl>

          <section className="app-card p-6" aria-labelledby={previewTitleId}>
            <h2 id={previewTitleId} className="app-section-title mb-4">
              Email body
            </h2>
            <iframe
              title={`Email body for ${email.subject}`}
              sandbox=""
              referrerPolicy="no-referrer"
              srcDoc={email.htmlBody}
              className="h-[70vh] min-h-[24rem] w-full rounded-md border border-gray-200 bg-white dark:border-gray-700"
            />
          </section>
        </div>
      ) : null}
    </AppPage>
  );
}
