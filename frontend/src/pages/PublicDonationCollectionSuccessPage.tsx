import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout';
import SeoMeta from '../components/SeoMeta';
import api, { formatApiError } from '../utils/api';

type DonationOrder = {
  amountMinor: number;
  currency: string;
  status: string;
  donorEmail: string | null;
  causeName: string | null;
  completedAt: string | null;
  createdAt: string;
  donationReference: string;
};

function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: (currency || 'usd').toUpperCase(),
  }).format(amountMinor / 100);
}

function feeNote(causeName: string): string {
  return `Your full donation amount will be collected for ${causeName}, less any credit card processing fees (about 3%).`;
}

export default function PublicDonationCollectionSuccessPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const orderToken = searchParams.get('orderToken')?.trim() || '';
  const sessionId = searchParams.get('session_id')?.trim() || '';
  const [order, setOrder] = useState<DonationOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderToken) {
      setError('Missing donation order token. Use the return link from checkout.');
      return;
    }
    let cancelled = false;
    let timer: number | null = null;
    let attempts = 0;

    const load = async () => {
      attempts += 1;
      try {
        const response = await api.post(`/public/donations/orders/${encodeURIComponent(orderToken)}/resolve`, {
          ...(sessionId ? { sessionId } : {}),
        });
        if (cancelled) return;
        const next = response.data?.order as DonationOrder | undefined;
        if (!next) {
          setError('Unable to confirm this donation.');
          return;
        }
        setOrder(next);
        setError(null);
        if ((next.status === 'created' || next.status === 'pending') && attempts < 20) {
          timer = window.setTimeout(() => {
            void load();
          }, 1500);
        }
      } catch (loadError) {
        if (!cancelled) setError(formatApiError(loadError, 'Unable to confirm this donation.'));
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [orderToken, sessionId]);

  const succeeded = order?.status === 'succeeded';
  const causeName = order?.causeName?.trim() || 'this cause';
  const receiptHref = orderToken ? `/payments/${encodeURIComponent(orderToken)}` : null;

  return (
    <PublicLayout>
      <SeoMeta
        title={succeeded ? 'Donation received | Triangle Curling Club' : 'Donation update | Triangle Curling Club'}
        description="Confirmation for your donation."
        canonicalPath={slug ? `/donations/${slug}/success` : '/donations'}
      />
      <div className="public-container public-section">
        <section className="public-card mx-auto max-w-2xl space-y-4 p-7 sm:p-9">
          <div className="public-page-title-rule">
            <h1 className="public-heading">{succeeded ? 'Thank you' : 'Donation update'}</h1>
          </div>
          {!order && !error ? <p className="text-sm text-gray-700">Confirming your donation…</p> : null}
          {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p> : null}
          {order ? (
            <>
              <p className="text-sm text-gray-800">
                {succeeded
                  ? `We received your donation of ${formatMoney(order.amountMinor, order.currency)} for ${causeName}.`
                  : 'Your payment is still processing. This page checks again automatically.'}
              </p>
              {succeeded ? <p className="text-sm text-gray-700">{feeNote(causeName)}</p> : null}
              {succeeded && order.donorEmail ? (
                <p className="text-sm text-gray-700">
                  A confirmation email is on its way to <strong>{order.donorEmail}</strong>.
                </p>
              ) : null}
              {succeeded && receiptHref ? (
                <p>
                  <Link to={receiptHref} className="text-sm font-semibold text-emerald-800 hover:underline">
                    View your receipt
                  </Link>
                </p>
              ) : null}
              <dl className="grid gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-gray-600">Reference</dt>
                  <dd className="font-semibold text-gray-900">{order.donationReference}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-gray-600">Status</dt>
                  <dd className="font-semibold text-gray-900">{order.status}</dd>
                </div>
              </dl>
            </>
          ) : null}
          <Link to={`/donations/${slug}`} className="inline-flex text-sm font-semibold text-emerald-800 hover:underline">
            Back to the donation page
          </Link>
        </section>
      </div>
    </PublicLayout>
  );
}
