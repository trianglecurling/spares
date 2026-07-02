import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import SeoMeta from '../components/SeoMeta';
import api from '../utils/api';

type ResolveResponse = {
  status?: string;
  registrationStatus?: string | null;
  registrationId?: number;
  refundIssued?: boolean;
  waitlistPosition?: number | null;
  waitlistLength?: number | null;
};

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 15;

const REFUND_SENTENCE =
  'A full refund has been issued, and it should appear on your statement within the next few business days.';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isRegistrationSettled(registrationStatus: string | null | undefined): boolean {
  return (
    registrationStatus === 'confirmed' ||
    registrationStatus === 'waitlisted' ||
    registrationStatus === 'cancelled'
  );
}

function formatWaitlistPosition(position: number | null | undefined, length: number | null | undefined): string {
  if (position != null && length != null) {
    return `You have been placed on the waitlist at position ${position} of ${length}.`;
  }
  if (position != null) {
    return `You have been placed on the waitlist at position ${position}.`;
  }
  return 'You have been placed on the waitlist.';
}

export default function PublicEventRegisterSuccessPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const registrationId = searchParams.get('registrationId');
  const sessionId = searchParams.get('session_id');
  const [status, setStatus] = useState<
    'resolving' | 'confirmed' | 'waitlisted' | 'cancelled' | 'processing' | 'error'
  >('resolving');
  const [error, setError] = useState<string | null>(null);
  const [refundIssued, setRefundIssued] = useState(false);
  const [waitlistPosition, setWaitlistPosition] = useState<number | null>(null);
  const [waitlistLength, setWaitlistLength] = useState<number | null>(null);

  useEffect(() => {
    if (!registrationId) {
      setStatus('error');
      setError('Missing registration reference.');
      return;
    }

    let canceled = false;

    const resolveOnce = async (): Promise<ResolveResponse> => {
      const res = await api.post<ResolveResponse>(
        `/public/events/registrations/${registrationId}/resolve`,
        sessionId ? { sessionId } : {},
      );
      return res.data;
    };

    const run = async () => {
      for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt += 1) {
        if (canceled) return;
        try {
          const data = await resolveOnce();
          if (canceled) return;

          if (data.refundIssued) {
            setRefundIssued(true);
          }
          if (data.waitlistPosition != null) {
            setWaitlistPosition(data.waitlistPosition);
          }
          if (data.waitlistLength != null) {
            setWaitlistLength(data.waitlistLength);
          }

          if (data.registrationStatus === 'confirmed') {
            setStatus('confirmed');
            return;
          }
          if (data.registrationStatus === 'waitlisted') {
            setStatus('waitlisted');
            return;
          }
          if (data.registrationStatus === 'cancelled' && data.refundIssued) {
            setStatus('cancelled');
            return;
          }
          if (data.status === 'failed') {
            setStatus('error');
            setError('Payment did not complete. Return to the event to try registering again.');
            return;
          }
          if (isRegistrationSettled(data.registrationStatus)) {
            if (data.registrationStatus === 'waitlisted') {
              setStatus('waitlisted');
            } else if (data.registrationStatus === 'cancelled') {
              setStatus('cancelled');
            } else {
              setStatus('confirmed');
            }
            return;
          }

          if (attempt < MAX_POLL_ATTEMPTS) {
            await sleep(POLL_INTERVAL_MS);
          }
        } catch {
          if (canceled) return;
          if (attempt >= MAX_POLL_ATTEMPTS) break;
          await sleep(POLL_INTERVAL_MS);
        }
      }

      if (!canceled) {
        setStatus('processing');
        setError(
          'Your payment is still processing. You will receive a confirmation email once your registration is complete.',
        );
      }
    };

    void run();

    return () => {
      canceled = true;
    };
  }, [registrationId, sessionId]);

  return (
    <PublicLayout>
      <SeoMeta title="Registration Complete" />
      <div className="max-w-2xl mx-auto px-4 py-16">
        {status === 'resolving' && <PublicStateCard title="Verifying your payment..." />}

        {status === 'confirmed' && (
          <PublicStateCard
            tone="success"
            title="Registration confirmed!"
            description="Your payment has been processed and your spot is confirmed. A confirmation email has been sent."
            action={
              <Link to={`/events/${slug}`} className="text-primary-teal-link hover:underline">
                Back to event
              </Link>
            }
          />
        )}

        {status === 'waitlisted' && (
          <PublicStateCard
            tone="neutral"
            title={refundIssued ? 'Placed on waitlist' : 'Payment received'}
            description={
              refundIssued
                ? `The event filled before your payment completed. ${formatWaitlistPosition(waitlistPosition, waitlistLength)} ${REFUND_SENTENCE}`
                : `Your payment was processed, but the event filled before confirmation completed. ${formatWaitlistPosition(waitlistPosition, waitlistLength)} We will contact you if a spot opens.`
            }
            action={
              <Link to={`/events/${slug}`} className="text-primary-teal-link hover:underline">
                Back to event
              </Link>
            }
          />
        )}

        {status === 'cancelled' && (
          <PublicStateCard
            tone="warning"
            title="Registration could not be completed"
            description={`The event filled before your payment completed, and your registration could not be completed. ${REFUND_SENTENCE}`}
            action={
              <Link to={`/events/${slug}`} className="text-primary-teal-link hover:underline">
                Back to event
              </Link>
            }
          />
        )}

        {(status === 'processing' || status === 'error') && (
          <PublicStateCard
            tone={status === 'error' ? 'error' : 'warning'}
            title={status === 'error' ? 'Payment not completed' : 'Payment processing'}
            description={
              error ||
              'Your payment is being processed. You will receive a confirmation email once your registration is complete.'
            }
            action={
              <Link to={`/events/${slug}`} className="text-primary-teal-link hover:underline">
                Back to event
              </Link>
            }
          />
        )}
      </div>
    </PublicLayout>
  );
}
