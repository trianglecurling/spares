import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import SeoMeta from '../components/SeoMeta';
import PaymentDetailContent from '../components/payments/PaymentDetailContent';
import api, { formatApiError } from '../utils/api';
import type { MemberPaymentDetail } from '../../../backend/src/api/types';

type ResolveResponse = {
  status?: string;
  registrationStatus?: string | null;
  registrationId?: number;
  manageAccessToken?: string | null;
  orderToken?: string | null;
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
  const [manageAccessToken, setManageAccessToken] = useState<string | null>(null);
  const [orderToken, setOrderToken] = useState<string | null>(null);
  const [receiptDetail, setReceiptDetail] = useState<MemberPaymentDetail | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);

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
          if (data.manageAccessToken) {
            setManageAccessToken(data.manageAccessToken);
          }
          if (data.orderToken) {
            setOrderToken(data.orderToken);
          }

          if (data.status === 'failed') {
            setStatus('error');
            setError('Payment did not complete. Return to the event to try registering again.');
            return;
          }

          if (data.registrationStatus === 'confirmed') {
            // Wait for provider-confirmed payment (order token) when possible so the receipt can load.
            if (data.orderToken || attempt >= MAX_POLL_ATTEMPTS) {
              setStatus('confirmed');
              return;
            }
            await sleep(POLL_INTERVAL_MS);
            continue;
          }

          if (data.registrationStatus === 'waitlisted') {
            setStatus('waitlisted');
            return;
          }
          if (data.registrationStatus === 'cancelled' && data.refundIssued) {
            setStatus('cancelled');
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

  useEffect(() => {
    if (status !== 'confirmed' || !orderToken) {
      setReceiptDetail(null);
      setReceiptError(null);
      setReceiptLoading(false);
      return;
    }

    let canceled = false;
    setReceiptLoading(true);
    setReceiptError(null);

    api
      .get<MemberPaymentDetail>(`/public/payments/${encodeURIComponent(orderToken)}`)
      .then((res) => {
        if (canceled) return;
        // Only show the receipt after the provider-backed payment order is confirmed.
        if (res.data.status === 'succeeded' || res.data.status === 'partially_refunded') {
          setReceiptDetail(res.data);
        } else {
          setReceiptDetail(null);
        }
      })
      .catch((err: unknown) => {
        if (!canceled) {
          setReceiptDetail(null);
          setReceiptError(formatApiError(err, 'Could not load payment receipt.'));
        }
      })
      .finally(() => {
        if (!canceled) setReceiptLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, [status, orderToken]);

  return (
    <PublicLayout>
      <SeoMeta title="Registration Complete" />
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-16">
        {status === 'resolving' && <PublicStateCard title="Verifying your payment..." />}

        {status === 'confirmed' && (
          <>
            <PublicStateCard
              tone="success"
              title="Registration confirmed!"
              description="Your payment has been processed and your spot is confirmed. A confirmation email has been sent."
              action={
                <span className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
                  {manageAccessToken ? (
                    <>
                      <Link
                        to={`/events/registrations/manage/${encodeURIComponent(manageAccessToken)}`}
                        className="text-primary-teal-link hover:underline"
                      >
                        Manage registration
                      </Link>
                      <span aria-hidden="true" className="text-current/40">
                        |
                      </span>
                    </>
                  ) : null}
                  <Link to={`/events/${slug}`} className="text-primary-teal-link hover:underline">
                    Back to event
                  </Link>
                </span>
              }
            />

            {receiptLoading ? (
              <PublicStateCard title="Loading payment receipt..." />
            ) : receiptDetail ? (
              <div className="space-y-3">
                <h2 className="text-lg font-semibold text-gray-900">Payment receipt</h2>
                <PaymentDetailContent detail={receiptDetail} publicTheme />
              </div>
            ) : receiptError ? (
              <PublicStateCard
                tone="warning"
                title="Payment receipt unavailable"
                description={receiptError}
              />
            ) : null}
          </>
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
