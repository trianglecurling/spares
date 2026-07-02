import axios from 'axios';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Button from '../components/Button';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import SeoMeta from '../components/SeoMeta';
import api, { getApiErrorMessage } from '../utils/api';
import { useConfirm } from '../contexts/ConfirmContext';

type WaitlistOfferPayload = {
  offer: {
    id: number;
    status: 'pending' | 'accepted' | 'declined' | 'superseded';
    expiresAt: string;
    expired: boolean;
    claimable: boolean;
    waitlistPosition: number | null;
  };
  event: {
    id: number;
    title: string;
    slug: string;
    feeMinor: number;
    totalFeeMinor: number;
    currency: string;
    timespans: Array<{ start_dt: string; end_dt: string }>;
  };
  registration: {
    contactName: string;
    groupSize: number;
    waitlistPosition: number | null;
  };
};

type AcceptResponse = {
  checkoutUrl?: string | null;
  confirmed?: boolean;
  registrationId?: number;
  offerId?: number;
};

type ResolveResponse = {
  paymentStatus?: string;
  offerStatus?: 'pending' | 'accepted' | 'declined' | 'superseded';
  offerId?: number;
  confirmed?: boolean;
  offerNoLongerAvailable?: boolean;
  eventSlug?: string;
};

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 15;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function formatFee(feeMinor: number, currency: string): string {
  if (feeMinor <= 0) return 'Free';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'usd',
  }).format(feeMinor / 100);
}

function formatEventDate(timespans: WaitlistOfferPayload['event']['timespans']): string | null {
  const first = timespans[0];
  if (!first) return null;
  try {
    const start = new Date(first.start_dt);
    const end = new Date(first.end_dt);
    const sameDay =
      start.getFullYear() === end.getFullYear() &&
      start.getMonth() === end.getMonth() &&
      start.getDate() === end.getDate();
    if (sameDay) {
      const date = start.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
      const timeRange = `${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} – ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
      return `${date}, ${timeRange}`;
    }
    return `${start.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} – ${end.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`;
  } catch {
    return null;
  }
}

function formatRespondByDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getApiErrorCode(error: unknown): string | null {
  if (axios.isAxiosError(error)) {
    const details = error.response?.data?.details;
    if (details && typeof details === 'object' && 'code' in details) {
      const code = (details as { code?: unknown }).code;
      return typeof code === 'string' ? code : null;
    }
  }
  return null;
}

export default function PublicEventWaitlistOfferPage() {
  const { responseToken } = useParams<{ responseToken: string }>();
  const [searchParams] = useSearchParams();
  const paidReturn = searchParams.get('paid') === 'true';
  const sessionId = searchParams.get('session_id');
  const checkoutCanceled = searchParams.get('canceled') === 'true';
  const actionDecline = searchParams.get('action') === 'decline';
  const { confirm } = useConfirm();

  const [payload, setPayload] = useState<WaitlistOfferPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [offerUnavailable, setOfferUnavailable] = useState(false);
  const [verifyingPayment, setVerifyingPayment] = useState(paidReturn);
  const [paymentStillProcessing, setPaymentStillProcessing] = useState(false);

  const declineSectionRef = useRef<HTMLDivElement | null>(null);
  const declineButtonId = useId();

  const loadOffer = useCallback(async (): Promise<WaitlistOfferPayload | null> => {
    if (!responseToken) return null;
    const res = await api.get<WaitlistOfferPayload>(
      `/public/events/waitlist-offers/${encodeURIComponent(responseToken)}`,
    );
    return res.data;
  }, [responseToken]);

  useEffect(() => {
    if (!responseToken) {
      setLoadError('This offer link is missing a token.');
      setLoading(false);
      return;
    }

    let canceled = false;
    setLoading(true);
    setLoadError(null);

    loadOffer()
      .then((data) => {
        if (canceled) return;
        if (!data) {
          setLoadError('Offer not found.');
          return;
        }
        setPayload(data);
      })
      .catch(() => {
        if (!canceled) setLoadError('Offer not found.');
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, [responseToken, loadOffer]);

  useEffect(() => {
    if (!actionDecline || loading || !payload) return;
    declineSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const button = document.getElementById(declineButtonId);
    button?.focus({ preventScroll: true });
  }, [actionDecline, loading, payload, declineButtonId]);

  useEffect(() => {
    if (!paidReturn || !responseToken || loading) return;

    let canceled = false;

    const resolveOnce = async (): Promise<ResolveResponse> => {
      const res = await api.post<ResolveResponse>(
        `/public/events/waitlist-offers/${encodeURIComponent(responseToken)}/resolve`,
        sessionId ? { sessionId } : {},
      );
      return res.data;
    };

    const poll = async () => {
      setVerifyingPayment(true);
      setPaymentStillProcessing(false);

      for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt += 1) {
        if (canceled) return;
        try {
          const data = await resolveOnce();
          if (canceled) return;

          if (data.confirmed || data.offerStatus === 'accepted') {
            const refreshed = await loadOffer();
            if (!canceled && refreshed) setPayload(refreshed);
            setVerifyingPayment(false);
            return;
          }

          if (data.offerNoLongerAvailable) {
            const refreshed = await loadOffer();
            if (!canceled && refreshed) setPayload(refreshed);
            setOfferUnavailable(true);
            setVerifyingPayment(false);
            return;
          }

          if (data.paymentStatus === 'failed') {
            setActionError('Payment did not complete. Return to the offer page to try again.');
            setVerifyingPayment(false);
            return;
          }

          if (attempt < MAX_POLL_ATTEMPTS) {
            await sleep(POLL_INTERVAL_MS);
          }
        } catch {
          if (canceled) return;
          if (attempt < MAX_POLL_ATTEMPTS) {
            await sleep(POLL_INTERVAL_MS);
          }
        }
      }

      if (!canceled) {
        setVerifyingPayment(false);
        setPaymentStillProcessing(true);
      }
    };

    void poll();

    return () => {
      canceled = true;
    };
  }, [paidReturn, responseToken, loading, loadOffer, sessionId]);

  const handleAccept = async () => {
    if (!responseToken || accepting) return;
    setAccepting(true);
    setActionError(null);
    try {
      const res = await api.post<AcceptResponse>(
        `/public/events/waitlist-offers/${encodeURIComponent(responseToken)}/accept`,
        {},
      );
      if (res.data.checkoutUrl) {
        window.location.href = res.data.checkoutUrl;
        return;
      }
      const refreshed = await loadOffer();
      if (refreshed) setPayload(refreshed);
    } catch (error) {
      if (getApiErrorCode(error) === 'offer_no_longer_available') {
        setOfferUnavailable(true);
      } else {
        setActionError(getApiErrorMessage(error, 'Unable to accept this offer.'));
      }
    } finally {
      setAccepting(false);
    }
  };

  const handleDecline = async () => {
    if (!responseToken || declining) return;

    const confirmed = await confirm({
      title: 'Decline this spot?',
      message:
        'If you decline, you will be removed from the waitlist and this spot may be offered to someone else.',
      confirmText: 'Decline spot',
      cancelText: 'Keep offer',
      variant: 'warning',
    });
    if (!confirmed) return;

    setDeclining(true);
    setActionError(null);
    try {
      await api.post(`/public/events/waitlist-offers/${encodeURIComponent(responseToken)}/decline`, {});
      const refreshed = await loadOffer();
      if (refreshed) setPayload(refreshed);
    } catch (error) {
      setActionError(getApiErrorMessage(error, 'Unable to decline this offer.'));
    } finally {
      setDeclining(false);
    }
  };

  if (loading) {
    return (
      <PublicLayout>
        <PublicStateCard title="Loading your offer..." />
      </PublicLayout>
    );
  }

  if (loadError || !payload) {
    return (
      <PublicLayout>
        <PublicStateCard
          title="Offer not found"
          description={loadError || 'This link may be invalid or expired.'}
          action={
            <Link to="/events" className="text-primary-teal-link hover:underline">
              Browse events
            </Link>
          }
        />
      </PublicLayout>
    );
  }

  const { offer, event, registration } = payload;
  const eventDate = formatEventDate(event.timespans);
  const acceptLabel = event.totalFeeMinor > 0 ? 'Accept and pay' : 'Accept spot';

  if (offerUnavailable || offer.status === 'superseded') {
    return (
      <PublicLayout>
        <SeoMeta title="Spot no longer available" />
        <div className="max-w-2xl mx-auto px-4 py-16">
          <PublicStateCard
            tone="warning"
            title="We're sorry — this spot is no longer available"
            description={`This spot has since been offered to another registrant. We apologize for the inconvenience.${
              event.totalFeeMinor > 0
                ? ' If you completed a payment for this offer, a full refund will be issued and should appear on your statement within the next few business days.'
                : ''
            }`}
            action={
              <Link to={`/events/${event.slug}`} className="text-primary-teal-link hover:underline">
                Back to event
              </Link>
            }
          />
        </div>
      </PublicLayout>
    );
  }

  if (offer.status === 'accepted') {
    return (
      <PublicLayout>
        <SeoMeta title="Spot confirmed" />
        <div className="max-w-2xl mx-auto px-4 py-16">
          <PublicStateCard
            tone="success"
            title="Your spot is confirmed"
            description={`You are confirmed for ${event.title}. A confirmation email has been sent.`}
            action={
              <Link to={`/events/${event.slug}`} className="text-primary-teal-link hover:underline">
                Back to event
              </Link>
            }
          />
        </div>
      </PublicLayout>
    );
  }

  if (verifyingPayment) {
    return (
      <PublicLayout>
        <SeoMeta title="Verifying payment" />
        <div className="max-w-2xl mx-auto px-4 py-16">
          <PublicStateCard title="Verifying your payment..." description="This usually takes just a moment." />
        </div>
      </PublicLayout>
    );
  }

  if (paymentStillProcessing) {
    return (
      <PublicLayout>
        <SeoMeta title="Payment processing" />
        <div className="max-w-2xl mx-auto px-4 py-16">
          <PublicStateCard
            tone="warning"
            title="Payment processing"
            description="Your payment is still processing. You will receive a confirmation email once your spot is confirmed."
            action={
              <Link to={`/events/${event.slug}`} className="text-primary-teal-link hover:underline">
                Back to event
              </Link>
            }
          />
        </div>
      </PublicLayout>
    );
  }

  if (offer.status === 'declined') {
    const declinedByRegistrant = registration.waitlistPosition == null;
    if (declinedByRegistrant) {
      return (
        <PublicLayout>
          <SeoMeta title="Offer declined" />
          <div className="max-w-2xl mx-auto px-4 py-16">
            <PublicStateCard
              title="You declined this offer"
              description={`You declined the spot offered for ${event.title}.`}
              action={
                <Link to={`/events/${event.slug}`} className="text-primary-teal-link hover:underline">
                  Back to event
                </Link>
              }
            />
          </div>
        </PublicLayout>
      );
    }

    return (
      <PublicLayout>
        <SeoMeta title="Spot no longer available" />
        <div className="max-w-2xl mx-auto px-4 py-16">
          <PublicStateCard
            tone="warning"
            title="We're sorry — this spot is no longer available"
            description={`This spot has since been offered to another registrant. We apologize for the inconvenience.${
              event.totalFeeMinor > 0
                ? ' If you completed a payment for this offer, a full refund will be issued and should appear on your statement within the next few business days.'
                : ''
            }`}
            action={
              <Link to={`/events/${event.slug}`} className="text-primary-teal-link hover:underline">
                Back to event
              </Link>
            }
          />
        </div>
      </PublicLayout>
    );
  }

  if (offer.status === 'pending' && offer.claimable) {
    return (
      <PublicLayout>
        <SeoMeta title="Waitlist spot available" />
        <div className="max-w-2xl mx-auto px-4 py-10">
          <Link to={`/events/${event.slug}`} className="text-sm text-primary-teal-link hover:underline mb-6 inline-block">
            &larr; Back to event
          </Link>

          <div className="public-card p-6 sm:p-8 space-y-6">
            <div className="space-y-2 text-center">
              <h1 className="text-2xl font-bold text-gray-900">A spot opened up</h1>
              <p className="text-gray-700">
                Good news — a spot is available for <span className="font-medium">{event.title}</span>.
              </p>
            </div>

            {checkoutCanceled ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                Checkout was not completed. You can accept the spot below when you are ready.
              </div>
            ) : null}

            <dl className="space-y-3 text-sm text-gray-700">
              {eventDate ? (
                <div>
                  <dt className="font-medium text-gray-900">Event date</dt>
                  <dd>{eventDate}</dd>
                </div>
              ) : null}
              <div>
                <dt className="font-medium text-gray-900">Your total</dt>
                <dd>{formatFee(event.totalFeeMinor, event.currency)}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-900">Respond by</dt>
                <dd>{formatRespondByDate(offer.expiresAt)}</dd>
              </div>
              {registration.groupSize > 1 ? (
                <div>
                  <dt className="font-medium text-gray-900">Group size</dt>
                  <dd>{registration.groupSize} people</dd>
                </div>
              ) : null}
            </dl>

            {offer.expired ? (
              <p className="text-sm text-gray-600">
                The respond-by date has passed, but this spot is still available until it is offered to someone else.
              </p>
            ) : null}

            {actionError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{actionError}</div>
            ) : null}

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button type="button" onClick={() => void handleAccept()} disabled={accepting || declining}>
                {accepting ? 'Processing...' : acceptLabel}
              </Button>
            </div>

            <div ref={declineSectionRef} className="border-t border-gray-200 pt-6 text-center space-y-3">
              <p className="text-sm text-gray-600">Not able to take this spot?</p>
              <Button
                id={declineButtonId}
                type="button"
                variant="outline-danger"
                onClick={() => void handleDecline()}
                disabled={accepting || declining}
              >
                {declining ? 'Declining...' : 'Decline spot'}
              </Button>
            </div>
          </div>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <SeoMeta title="Spot no longer available" />
      <div className="max-w-2xl mx-auto px-4 py-16">
        <PublicStateCard
          tone="warning"
          title="We're sorry — this spot is no longer available"
          description={`This spot has since been offered to another registrant. We apologize for the inconvenience.${
            event.totalFeeMinor > 0
              ? ' If you completed a payment for this offer, a full refund will be issued and should appear on your statement within the next few business days.'
              : ''
          }`}
          action={
            <Link to={`/events/${event.slug}`} className="text-primary-teal-link hover:underline">
              Back to event
            </Link>
          }
        />
      </div>
    </PublicLayout>
  );
}
