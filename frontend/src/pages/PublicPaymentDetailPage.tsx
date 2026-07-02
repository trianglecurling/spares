import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import SeoMeta from '../components/SeoMeta';
import PaymentDetailContent from '../components/payments/PaymentDetailContent';
import api, { formatApiError } from '../utils/api';
import type { MemberPaymentDetail } from '../../../backend/src/api/types';

export default function PublicPaymentDetailPage() {
  const { orderToken } = useParams<{ orderToken: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<MemberPaymentDetail | null>(null);

  useEffect(() => {
    if (!orderToken) {
      setLoading(false);
      setError('Payment not found.');
      return;
    }

    let canceled = false;
    const loadDetail = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data } = await api.get<MemberPaymentDetail>(`/public/payments/${encodeURIComponent(orderToken)}`);
        if (!canceled) {
          setDetail(data);
        }
      } catch (loadError) {
        if (!canceled) {
          setDetail(null);
          setError(formatApiError(loadError, 'Could not load payment details.'));
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    };

    void loadDetail();
    return () => {
      canceled = true;
    };
  }, [orderToken]);

  const pageTitle = detail?.description ? `${detail.description} | Payment details` : 'Payment details';

  return (
    <PublicLayout>
      <SeoMeta
        title={`${pageTitle} | Triangle Curling Club`}
        description="View payment details for a Triangle Curling Club transaction."
        canonicalPath={orderToken ? `/payments/${orderToken}` : '/payments'}
      />

      <div className="public-container public-section max-w-3xl space-y-6">
        {loading ? (
          <PublicStateCard title="Loading payment details…" />
        ) : error ? (
          <PublicStateCard title="Unable to load payment details" description={error} tone="error" />
        ) : detail ? (
          <>
            <div className="space-y-2">
              <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Payment details</p>
              <h1 className="public-heading text-balance">{detail.description}</h1>
            </div>
            <PaymentDetailContent detail={detail} publicTheme />
          </>
        ) : (
          <PublicStateCard title="Payment not found" tone="error" />
        )}

        <p className="text-center text-sm text-gray-600">
          <Link to="/" className="text-emerald-700 hover:text-emerald-800 hover:underline">
            Back to home
          </Link>
        </p>
      </div>
    </PublicLayout>
  );
}
