import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout';
import SeoMeta from '../components/SeoMeta';
import api from '../utils/api';

export default function PublicEventRegisterSuccessPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const registrationId = searchParams.get('registrationId');
  const sessionId = searchParams.get('session_id');
  const [status, setStatus] = useState<string>('resolving');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!registrationId || !sessionId) {
      setStatus('confirmed');
      return;
    }

    api.post(`/public/events/registrations/${registrationId}/resolve`, { sessionId })
      .then((res) => {
        setStatus(res.data?.status === 'succeeded' ? 'confirmed' : res.data?.status || 'confirmed');
      })
      .catch(() => {
        setError('Unable to verify your payment. If you were charged, your registration will be confirmed shortly.');
        setStatus('unknown');
      });
  }, [registrationId, sessionId]);

  return (
    <PublicLayout>
      <SeoMeta title="Registration Complete" />
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        {status === 'resolving' && (
          <p className="text-gray-500 text-lg">Verifying your payment...</p>
        )}

        {status === 'confirmed' && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-8">
            <h1 className="text-2xl font-bold text-green-800 mb-4">Registration Confirmed!</h1>
            <p className="text-green-700 mb-6">
              Your payment has been processed and your spot is confirmed. A confirmation email has been sent.
            </p>
            <Link to={`/events/${slug}`} className="text-primary-teal-link hover:underline">
              Back to event
            </Link>
          </div>
        )}

        {(status === 'unknown' || error) && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-8">
            <h1 className="text-2xl font-bold text-yellow-800 mb-4">Payment Processing</h1>
            <p className="text-yellow-700 mb-6">
              {error || 'Your payment is being processed. You will receive a confirmation email once complete.'}
            </p>
            <Link to={`/events/${slug}`} className="text-primary-teal-link hover:underline">
              Back to event
            </Link>
          </div>
        )}
      </div>
    </PublicLayout>
  );
}
