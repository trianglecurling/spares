import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { AppPage, AppPageHeader } from '../components/AppPage';
import AppStateCard from '../components/AppStateCard';
import Button from '../components/Button';
import api, { getApiErrorMessage } from '../utils/api';

type RegistrationSummary = {
  id: number;
  curlerName: string;
  seasonName: string;
  sessionName: string;
  registrationStatus: string;
  paymentStatus: string;
  membershipOption: string;
  amountDueMinor: number | null;
  paymentLink: string | null;
  submittedAt: string | null;
  updatedAt: string | null;
};

function money(minor: number | null) {
  if (minor == null) return 'Not available';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minor / 100);
}

function statusLabel(value: string) {
  return value.replace(/_/g, ' ');
}

export default function RegistrationStatusPage() {
  const [registrations, setRegistrations] = useState<RegistrationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await api.get<{ registrations: RegistrationSummary[] }>('/registration/member/registrations');
        if (!cancelled) setRegistrations(response.data.registrations);
      } catch (err) {
        if (!cancelled) setError(getApiErrorMessage(err, 'Unable to load registrations.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Layout>
      <AppPage>
        <AppPageHeader
          title="Registration status"
          description="Review current and recent registrations, payment status, waitlists, and communications."
        />

        {loading ? <AppStateCard title="Loading registrations" description="Checking your registration records." /> : null}
        {error ? <AppStateCard title="Unable to load registrations" description={error} /> : null}
        {!loading && !error && registrations.length === 0 ? (
          <AppStateCard title="No submitted registrations" description="Submitted registrations for the active season will appear here." />
        ) : null}

        <div className="grid gap-4">
          {registrations.map((registration) => (
            <article key={registration.id} className="app-card">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="space-y-2">
                  <p className="text-sm font-semibold uppercase tracking-wide text-primary-teal">
                    {registration.seasonName} / {registration.sessionName}
                  </p>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{registration.curlerName}</h2>
                  <div className="flex flex-wrap gap-2 text-sm">
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-800 dark:bg-gray-800 dark:text-gray-100">
                      {statusLabel(registration.registrationStatus)}
                    </span>
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-800 dark:bg-gray-800 dark:text-gray-100">
                      Payment: {statusLabel(registration.paymentStatus)}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    Membership/program: {statusLabel(registration.membershipOption)}. Amount due: {money(registration.amountDueMinor)}.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {registration.paymentLink ? (
                    <a href={registration.paymentLink}>
                      <Button>Pay now</Button>
                    </a>
                  ) : null}
                  <Link to={`/registration/status/${registration.id}`}>
                    <Button variant="secondary">View details</Button>
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      </AppPage>
    </Layout>
  );
}
