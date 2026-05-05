import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout';
import SeoMeta from '../components/SeoMeta';
import api, { formatApiError } from '../utils/api';

type DonationStatus = 'created' | 'pending' | 'succeeded' | 'failed' | 'refunded' | 'partially_refunded';

interface DonationOrder {
  id: number;
  donationReference: string;
  provider: 'stripe' | 'paypal' | 'square';
  amountMinor: number;
  currency: string;
  status: DonationStatus;
  statusReason: string | null;
  createdAt: string;
  completedAt: string | null;
  donorName: string | null;
  donorEmail: string | null;
}

function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: (currency || 'usd').toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

const PROCESSING_GRACE_MS = 5000;
const POLL_INTERVAL_MS = 1000;

function formatDate(value: string | null): string {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function isPendingStatus(status: DonationStatus): boolean {
  return status === 'created' || status === 'pending';
}

export default function PublicDonateSuccessPage() {
  const [searchParams] = useSearchParams();
  const orderToken = searchParams.get('orderToken')?.trim() || '';
  const sessionId = searchParams.get('session_id')?.trim() || '';
  const [order, setOrder] = useState<DonationOrder | null>(null);
  const [isPolling, setIsPolling] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDetailedPending, setShowDetailedPending] = useState(false);

  useEffect(() => {
    if (!orderToken) {
      setIsPolling(false);
      setError('Missing donation order token. Please use the full return URL from checkout.');
      return;
    }

    let cancelled = false;
    let pollTimeoutId: number | null = null;
    let resolveAttempted = false;
    const detailTimerId = window.setTimeout(() => {
      if (cancelled) return;
      setShowDetailedPending(true);
    }, PROCESSING_GRACE_MS);

    const tryResolveFromCheckoutReturn = async (): Promise<boolean> => {
      if (!sessionId || resolveAttempted) return false;
      resolveAttempted = true;

      try {
        const response = await api.post(`/public/donations/orders/${encodeURIComponent(orderToken)}/resolve`, {
          sessionId,
        });
        if (cancelled) return false;
        const resolvedOrder: DonationOrder | null = response.data?.order ?? null;
        if (!resolvedOrder) return false;
        setOrder(resolvedOrder);
        setError(null);
        if (!isPendingStatus(resolvedOrder.status)) {
          setIsPolling(false);
          return true;
        }
      } catch {
        // Ignore return-path resolve failures and fall back to regular polling.
      }

      return false;
    };

    const poll = async () => {
      try {
        const resolved = await tryResolveFromCheckoutReturn();
        if (resolved) return;

        const response = await api.get(`/public/donations/orders/${encodeURIComponent(orderToken)}`);
        if (cancelled) return;
        const nextOrder: DonationOrder | null = response.data?.order ?? null;
        if (!nextOrder) {
          setError('Donation not found.');
          setIsPolling(false);
          return;
        }
        setOrder(nextOrder);
        setError(null);

        if (!isPendingStatus(nextOrder.status)) {
          setIsPolling(false);
          return;
        }

        pollTimeoutId = window.setTimeout(() => {
          void poll();
        }, POLL_INTERVAL_MS);
      } catch (requestError: unknown) {
        if (cancelled) return;
        setError(formatApiError(requestError, 'Unable to load donation status'));
        setIsPolling(false);
      }
    };
    void poll();

    return () => {
      cancelled = true;
      window.clearTimeout(detailTimerId);
      if (pollTimeoutId !== null) {
        window.clearTimeout(pollTimeoutId);
      }
    };
  }, [orderToken, sessionId]);

  const statusMessage = useMemo(() => {
    if (!order) return '';
    if (order.status === 'succeeded') return 'Donation received. Thank you for supporting Triangle Curling Club.';
    if (order.status === 'pending' || order.status === 'created') {
      return 'Your payment is still processing. This page auto-refreshes for a short time.';
    }
    if (order.status === 'partially_refunded') return 'This donation was partially refunded.';
    if (order.status === 'refunded') return 'This donation was refunded.';
    return 'This donation did not complete successfully.';
  }, [order]);

  const isPending = order ? isPendingStatus(order.status) : true;
  const showProcessingScreen = !error && isPending && !showDetailedPending;
  const isSuccess = order?.status === 'succeeded';

  return (
    <PublicLayout>
      <SeoMeta
        title={isSuccess ? 'Thank You | Triangle Curling Club' : 'Donation Update | Triangle Curling Club'}
        description={
          isSuccess
            ? 'Thank you for supporting Triangle Curling Club.'
            : 'Current status of your Triangle Curling Club donation.'
        }
        canonicalPath="/donate/success"
      />

      <div className="public-container public-section">
        <div className="mx-auto max-w-2xl">
          <section className="public-card p-7 sm:p-9">
            <div className="public-page-title-rule">
              <h1 className="public-heading">{isSuccess ? 'Thank you' : 'Donation update'}</h1>
            </div>

            {showProcessingScreen && (
              <p className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                Processing your donation confirmation...
              </p>
            )}

            {error && (
              <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>
            )}

            {!error && order && !showProcessingScreen && (
              <>
                <p
                  className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
                    order.status === 'succeeded'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : order.status === 'created' || order.status === 'pending'
                        ? 'border-amber-200 bg-amber-50 text-amber-800'
                        : 'border-red-200 bg-red-50 text-red-800'
                  }`}
                >
                  {statusMessage}
                </p>

                {isSuccess && (
                  <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                    An email confirmation letter has been sent to{' '}
                    <strong>{order.donorEmail ?? 'your email address'}</strong>. If you have any questions or concerns
                    with your donation, please contact treasurer@trianglecurling.com.
                  </p>
                )}

                <dl className="mt-6 grid gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm">
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-gray-600">Amount</dt>
                    <dd className="font-semibold text-gray-900">{formatMoney(order.amountMinor, order.currency)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-gray-600">Donation reference</dt>
                    <dd className="font-semibold text-gray-900">{order.donationReference}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-gray-600">Donation date</dt>
                    <dd className="font-semibold text-gray-900">{formatDate(order.completedAt ?? order.createdAt)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-gray-600">Status</dt>
                    <dd className="font-semibold text-gray-900">{order.status}</dd>
                  </div>
                </dl>

                {isPolling && !isSuccess && isPending && (
                  <p className="mt-3 text-xs text-gray-500">Still waiting on webhook confirmation. Checking again...</p>
                )}
              </>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/donate" className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
                Donate again
              </Link>
              <Link
                to="/"
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Back to homepage
              </Link>
            </div>
          </section>
        </div>
      </div>
    </PublicLayout>
  );
}
