import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { AppPage, AppPageHeader } from '../components/AppPage';
import AppStateCard from '../components/AppStateCard';
import Button from '../components/Button';
import api, { getApiErrorMessage } from '../utils/api';

export default function PublicWaitlistOfferDeclinePage() {
  const { offerId } = useParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Declining your waitlist offer.');

  useEffect(() => {
    let cancelled = false;
    async function decline() {
      if (!offerId) {
        setStatus('error');
        setMessage('This waitlist offer link is missing an offer id.');
        return;
      }
      try {
        await api.post(`/registration/member/waitlist-offers/${encodeURIComponent(offerId)}/decline`);
        if (cancelled) return;
        setStatus('success');
        setMessage('Your waitlist offer has been declined. If this was your first decline for this waitlist, your position is preserved. If it was your second decline, staff will move you to the bottom according to the waitlist rules.');
      } catch (error) {
        if (cancelled) return;
        setStatus('error');
        setMessage(getApiErrorMessage(error, 'Unable to decline this waitlist offer.'));
      }
    }
    void decline();
    return () => {
      cancelled = true;
    };
  }, [offerId]);

  return (
    <Layout>
      <AppPage narrow>
        <AppPageHeader title="Waitlist offer" description="League placement offers are tied to your account for safety." />
        <AppStateCard
          title={status === 'loading' ? 'Declining offer' : status === 'success' ? 'Offer declined' : 'Unable to decline offer'}
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
    </Layout>
  );
}
