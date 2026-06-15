import { Link, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { AppPage, AppPageHeader } from '../components/AppPage';
import AppStateCard from '../components/AppStateCard';
import Button from '../components/Button';
import api, { getApiErrorMessage } from '../utils/api';

export default function WaitlistOfferAcceptPage() {
  const { offerId } = useParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Accepting your waitlist offer.');

  useEffect(() => {
    let cancelled = false;
    async function accept() {
      if (!offerId) {
        setStatus('error');
        setMessage('This waitlist offer link is missing an offer id.');
        return;
      }
      try {
        await api.post(`/registration/member/waitlist-offers/${encodeURIComponent(offerId)}/accept`, {});
        if (cancelled) return;
        setStatus('success');
        setMessage('Your waitlist offer has been accepted. If payment is required, staff will follow up or your payment link will appear on your dashboard.');
      } catch (error) {
        if (cancelled) return;
        setStatus('error');
        setMessage(getApiErrorMessage(error, 'Unable to accept this waitlist offer.'));
      }
    }
    void accept();
    return () => {
      cancelled = true;
    };
  }, [offerId]);

  return (
    <>
      <AppPage narrow>
        <AppPageHeader title="Waitlist offer" description="League placement offers are tied to your account for safety." />
        <AppStateCard
          title={status === 'loading' ? 'Accepting offer' : status === 'success' ? 'Offer accepted' : 'Unable to accept offer'}
          description={message}
          action={
            status !== 'loading' ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Link to="/dashboard">
                  <Button>Return to dashboard</Button>
                </Link>
              </div>
            ) : null
          }
        />
      </AppPage>
    </>
  );
}
