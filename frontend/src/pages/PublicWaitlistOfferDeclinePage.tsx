import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import Button from '../components/Button';
import api, { getApiErrorMessage } from '../utils/api';

export default function PublicWaitlistOfferDeclinePage() {
  const { token } = useParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Declining your waitlist offer.');

  useEffect(() => {
    let cancelled = false;
    async function decline() {
      if (!token) {
        setStatus('error');
        setMessage('This waitlist offer link is missing a token.');
        return;
      }
      try {
        await api.post(`/registration/waitlist-offers/${encodeURIComponent(token)}/decline`);
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
  }, [token]);

  return (
    <PublicLayout>
      <PublicStateCard
        title={status === 'loading' ? 'Declining offer' : status === 'success' ? 'Offer declined' : 'Unable to decline offer'}
        description={message}
        action={
          status !== 'loading' ? (
            <Link to="/">
              <Button>Return home</Button>
            </Link>
          ) : null
        }
      />
    </PublicLayout>
  );
}
