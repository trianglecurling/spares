import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout';
import SeoMeta from '../components/SeoMeta';
import api, { formatApiError } from '../utils/api';

type DonationStatus = 'created' | 'pending' | 'succeeded' | 'failed' | 'refunded' | 'partially_refunded';

interface DonationOrder {
  id: number;
  orderToken: string;
  provider: 'stripe' | 'paypal' | 'square';
  amountMinor: number;
  currency: string;
  status: DonationStatus;
  statusReason: string | null;
  createdAt: string;
  completedAt: string | null;
}

function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: (currency || 'usd').toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

export default function PublicDonateCancelPage() {
  const [searchParams] = useSearchParams();
  const orderToken = searchParams.get('orderToken')?.trim() || '';
  const [order, setOrder] = useState<DonationOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderToken) return;
    api
      .get(`/public/donations/orders/${encodeURIComponent(orderToken)}`)
      .then((response) => {
        setOrder(response.data?.order ?? null);
        setError(null);
      })
      .catch((requestError: unknown) => {
        setError(formatApiError(requestError, 'Unable to load donation status'));
      });
  }, [orderToken]);

  return (
    <PublicLayout>
      <SeoMeta
        title="Donation Canceled | Triangle Curling Club"
        description="Donation checkout was canceled."
        canonicalPath="/donate/cancel"
      />

      <div className="public-container public-section">
        <div className="mx-auto max-w-2xl">
          <section className="public-card p-7 sm:p-9">
            <div className="public-page-title-rule">
              <h1 className="public-heading">Donation checkout canceled</h1>
            </div>
            <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              No worries - your payment was not completed.
            </p>

            {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}

            {order && (
              <dl className="mt-6 grid gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-gray-600">Amount</dt>
                  <dd className="font-semibold text-gray-900">{formatMoney(order.amountMinor, order.currency)}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-gray-600">Current order status</dt>
                  <dd className="font-semibold text-gray-900">{order.status}</dd>
                </div>
              </dl>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/donate" className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
                Try donation again
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
