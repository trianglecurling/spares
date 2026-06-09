import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { registrationWasPaymentDeferred } from './registration/registrationViewEditShared';
import Button from './Button';
import InlineStateMessage from './InlineStateMessage';
import api, { getApiErrorMessage } from '../utils/api';

type RegistrationSummary = {
  id: number;
  curlerId: number | null;
  curlerName: string;
  seasonName: string;
  sessionName: string;
  registrationStatus: string;
  isDraft: boolean;
  paymentStatus: string;
  membershipOption: string;
  amountDueMinor: number | null;
  paymentLink: string | null;
  viewSlot: number | null;
};

type DashboardRegistrationPayload = {
  visible: boolean;
  window: {
    state: 'closed' | 'priority' | 'open';
    season: { id: number; name: string };
    session: { id: number; name: string };
  } | null;
  registrations: RegistrationSummary[];
  showPriorityPrompt: boolean;
};

function money(minor: number | null) {
  if (minor == null) return 'Not available';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minor / 100);
}

function statusLabel(value: string) {
  return value.replace(/_/g, ' ');
}

function membershipOptionLabel(value: string) {
  if (value === 'social') return 'Social membership';
  if (value === 'junior_recreational') return 'Junior Recreational';
  return 'Regular membership';
}

function amountLabel(registration: RegistrationSummary) {
  if (isRegistrationPaid(registration)) return 'Amount paid';
  if (
    registrationWasPaymentDeferred({
      registrationStatus: registration.registrationStatus,
      paymentStatus: registration.paymentStatus,
    })
  ) {
    return 'Estimated amount due';
  }
  return 'Amount due';
}

function isRegistrationPaid(registration: RegistrationSummary) {
  return (
    registration.paymentStatus === 'paid' ||
    registration.registrationStatus === 'paid' ||
    registration.registrationStatus === 'confirmed'
  );
}

export default function DashboardRegistrationStatus() {
  const [data, setData] = useState<DashboardRegistrationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await api.get<DashboardRegistrationPayload>('/registration/member/dashboard-status');
        if (!cancelled) setData(response.data);
      } catch (err) {
        if (!cancelled) setError(getApiErrorMessage(err, 'Unable to load registration status.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <section>
        <h2 className="app-section-title mb-4">Registration status</h2>
        <InlineStateMessage title="Loading registration status" />
      </section>
    );
  }

  if (error) {
    return (
      <section>
        <h2 className="app-section-title mb-4">Registration status</h2>
        <InlineStateMessage title="Unable to load registration status" description={error} />
      </section>
    );
  }

  if (!data?.visible || !data.window) return null;

  const sessionName = data.window.session.name;

  return (
    <section className="space-y-3">
      <h2 className="app-section-title">Registration status</h2>

      {data.showPriorityPrompt ? (
        <div className="app-card">
          <p className="text-gray-800 dark:text-gray-100">
            You are not registered for {sessionName} yet.
          </p>
          <div className="mt-4">
            <Link to="/registration/start">
              <Button>Begin {sessionName} registration</Button>
            </Link>
          </div>
        </div>
      ) : null}

      {data.registrations.length > 0 ? (
        <div className="space-y-3">
          {data.registrations.map((registration) => (
            <article key={registration.id} className="app-card">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="space-y-2">
                  <p className="text-sm font-semibold uppercase tracking-wide text-primary-teal">
                    {registration.seasonName} / {registration.sessionName}
                  </p>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{registration.curlerName}</h3>
                  <div className="flex flex-wrap gap-2 text-sm">
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-800 dark:bg-gray-800 dark:text-gray-100">
                      {registration.isDraft ? 'In progress' : statusLabel(registration.registrationStatus)}
                    </span>
                    {!registration.isDraft ? (
                      <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-800 dark:bg-gray-800 dark:text-gray-100">
                        Payment: {statusLabel(registration.paymentStatus)}
                      </span>
                    ) : null}
                  </div>
                  {!registration.isDraft ? (
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      {membershipOptionLabel(registration.membershipOption)}. {amountLabel(registration)}:{' '}
                      {money(registration.amountDueMinor)}.
                    </p>
                  ) : (
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      This registration has not been submitted yet.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {registration.paymentLink ? (
                    <a href={registration.paymentLink}>
                      <Button>Pay now</Button>
                    </a>
                  ) : null}
                  {registration.isDraft ? (
                    <Link to="/registration/start">
                      <Button variant="secondary">Continue registration</Button>
                    </Link>
                  ) : registration.viewSlot != null ? (
                    <Link to={`/registration/view/${registration.viewSlot}`}>
                      <Button variant="secondary">View details</Button>
                    </Link>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
