import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { registrationWasPaymentDeferred } from './registration/registrationViewEditShared';
import Button from './Button';
import InlineStateMessage from './InlineStateMessage';
import { useAuth } from '../contexts/AuthContext';
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
  const label = value.replace(/_/g, ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function membershipOptionLabel(value: string) {
  if (value === 'social') return 'Social';
  if (value === 'junior_recreational') return 'Junior Recreational';
  return 'Regular';
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
  const { member } = useAuth();
  const [data, setData] = useState<DashboardRegistrationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        const response = await api.get<DashboardRegistrationPayload>(
          '/registration/member/dashboard-status'
        );
        if (!cancelled) setData(response.data);
      } catch (err) {
        if (!cancelled) {
          setData(null);
          setError(getApiErrorMessage(err, 'Unable to load registration status.'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [member?.id]);

  if (loading) {
    return (
      <section className="space-y-3">
        <h2 className="app-section-title">Registration status</h2>
        <InlineStateMessage title="Loading registration status" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="space-y-3">
        <h2 className="app-section-title">Registration status</h2>
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
        <div className="app-card flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-gray-800 dark:text-gray-100">
            You are not registered for {sessionName} yet.
          </p>
          <Link to="/registration/start" className="sm:shrink-0">
            <Button>Begin {sessionName} registration</Button>
          </Link>
        </div>
      ) : null}

      {data.registrations.length > 0 ? (
        <div className="space-y-3">
          {data.registrations.map((registration) => (
            <article key={registration.id} className="app-card">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-teal/80 dark:text-primary-teal">
                    {registration.seasonName} · {registration.sessionName}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                      {registration.curlerName}
                    </h3>
                    <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                      {registration.isDraft
                        ? 'In progress'
                        : statusLabel(registration.registrationStatus)}
                    </span>
                    {!registration.isDraft ? (
                      <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                        Payment: {statusLabel(registration.paymentStatus).toLowerCase()}
                      </span>
                    ) : null}
                  </div>
                  {!registration.isDraft ? (
                    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                      <div className="flex gap-1.5 text-gray-500 dark:text-gray-400">
                        {membershipOptionLabel(registration.membershipOption)} membership
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="text-gray-500 dark:text-gray-400">
                          {amountLabel(registration)}
                        </dt>
                        <dd className="font-medium text-gray-900 dark:text-gray-100">
                          {money(registration.amountDueMinor)}
                        </dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      This registration has not been submitted yet.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 md:shrink-0">
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
