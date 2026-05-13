import { Link, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { AppPage, AppPageHeader } from '../components/AppPage';
import AppStateCard from '../components/AppStateCard';
import Button from '../components/Button';
import api, { getApiErrorMessage } from '../utils/api';

export default function WaitlistOfferAcceptPage() {
  const { token } = useParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Accepting your waitlist offer.');

  useEffect(() => {
    let cancelled = false;
    async function accept() {
      if (!token) {
        setStatus('error');
        setMessage('This waitlist offer link is missing a token.');
        return;
      }
      try {
        await api.post(`/registration/member/waitlist-offers/${encodeURIComponent(token)}/accept`, {});
        if (cancelled) return;
        setStatus('success');
        setMessage('Your waitlist offer has been accepted. If payment is required, staff will follow up or your payment link will appear on your registration status page.');
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
  }, [token]);

  return (
    <Layout>
      <AppPage narrow>
        <AppPageHeader title="Waitlist offer" description="League placement offers are tied to your account for safety." />
        <AppStateCard
          title={status === 'loading' ? 'Accepting offer' : status === 'success' ? 'Offer accepted' : 'Unable to accept offer'}
          description={message}
          action={
            status !== 'loading' ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Link to="/registration/status">
                  <Button>View registration status</Button>
                </Link>
                <Link to="/dashboard">
                  <Button variant="secondary">Return to dashboard</Button>
                </Link>
              </div>
            ) : null
          }
        />
      </AppPage>
    </Layout>
  );
}
