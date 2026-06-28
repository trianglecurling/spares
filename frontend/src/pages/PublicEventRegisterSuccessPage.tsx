import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout';
import SeoMeta from '../components/SeoMeta';
import api from '../utils/api';

type ResolveResponse = {
  status?: string;
  registrationStatus?: string | null;
  registrationId?: number;
};

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 15;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isRegistrationSettled(registrationStatus: string | null | undefined): boolean {
  return registrationStatus === 'confirmed' || registrationStatus === 'waitlisted';
}

export default function PublicEventRegisterSuccessPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const registrationId = searchParams.get('registrationId');
  const sessionId = searchParams.get('session_id');
  const [status, setStatus] = useState<'resolving' | 'confirmed' | 'waitlisted' | 'processing' | 'error'>('resolving');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!registrationId) {
      setStatus('error');
      setError('Missing registration reference.');
      return;
    }

    let cancelled = false;

    const resolveOnce = async (): Promise<ResolveResponse> => {
      const res = await api.post<ResolveResponse>(
        `/public/events/registrations/${registrationId}/resolve`,
        sessionId ? { sessionId } : {},
      );
      return res.data;
    };

    const run = async () => {
      for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt += 1) {
        if (cancelled) return;
        try {
          const data = await resolveOnce();
          if (cancelled) return;

          if (data.registrationStatus === 'confirmed') {
            setStatus('confirmed');
            return;
          }
          if (data.registrationStatus === 'waitlisted') {
            setStatus('waitlisted');
            return;
          }
          if (data.status === 'failed') {
            setStatus('error');
            setError('Payment did not complete. Return to the event to try registering again.');
            return;
          }
          if (isRegistrationSettled(data.registrationStatus)) {
            setStatus(data.registrationStatus === 'waitlisted' ? 'waitlisted' : 'confirmed');
            return;
          }

          if (attempt < MAX_POLL_ATTEMPTS) {
            await sleep(POLL_INTERVAL_MS);
          }
        } catch {
          if (cancelled) return;
          if (attempt >= MAX_POLL_ATTEMPTS) break;
          await sleep(POLL_INTERVAL_MS);
        }
      }

      if (!cancelled) {
        setStatus('processing');
        setError(
          'Your payment is still processing. You will receive a confirmation email once your registration is complete.',
        );
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
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
            <h1 className="text-2xl font-bold text-green-800 mb-4">Registration confirmed!</h1>
            <p className="text-green-700 mb-6">
              Your payment has been processed and your spot is confirmed. A confirmation email has been sent.
            </p>
            <Link to={`/events/${slug}`} className="text-primary-teal-link hover:underline">
              Back to event
            </Link>
          </div>
        )}

        {status === 'waitlisted' && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-8">
            <h1 className="text-2xl font-bold text-blue-800 mb-4">Payment received</h1>
            <p className="text-blue-700 mb-6">
              Your payment was processed, but the event filled before confirmation completed. You have been placed on
              the waitlist. We will contact you if a spot opens.
            </p>
            <Link to={`/events/${slug}`} className="text-primary-teal-link hover:underline">
              Back to event
            </Link>
          </div>
        )}

        {(status === 'processing' || status === 'error') && (
          <div
            className={
              status === 'error'
                ? 'bg-red-50 border border-red-200 rounded-lg p-8'
                : 'bg-yellow-50 border border-yellow-200 rounded-lg p-8'
            }
          >
            <h1
              className={
                status === 'error'
                  ? 'text-2xl font-bold text-red-800 mb-4'
                  : 'text-2xl font-bold text-yellow-800 mb-4'
              }
            >
              {status === 'error' ? 'Payment not completed' : 'Payment processing'}
            </h1>
            <p className={status === 'error' ? 'text-red-700 mb-6' : 'text-yellow-700 mb-6'}>
              {error ||
                'Your payment is being processed. You will receive a confirmation email once your registration is complete.'}
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
