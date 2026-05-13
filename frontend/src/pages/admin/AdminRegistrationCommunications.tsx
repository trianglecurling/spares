import { useState } from 'react';
import Layout from '../../components/Layout';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import Button from '../../components/Button';
import api, { getApiErrorMessage } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';

type Communication = {
  id: number;
  messageType: string;
  recipientEmail: string;
  subject: string;
  deliveryStatus: string;
  sentAt: string | null;
  createdAt: string;
  errorDetail: string | null;
};

function label(value: string) {
  return value.replace(/_/g, ' ');
}

export default function AdminRegistrationCommunications() {
  const { showAlert } = useAlert();
  const [registrationId, setRegistrationId] = useState('');
  const [waitlistOfferId, setWaitlistOfferId] = useState('');
  const [communications, setCommunications] = useState<Communication[]>([]);
  const [loading, setLoading] = useState(false);

  async function loadCommunications() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (registrationId.trim()) params.set('registrationId', registrationId.trim());
      if (waitlistOfferId.trim()) params.set('waitlistOfferId', waitlistOfferId.trim());
      const response = await api.get<{ communications: Communication[] }>(`/registration/staff/communications?${params}`);
      setCommunications(response.data.communications);
    } catch (error) {
      showAlert(getApiErrorMessage(error, 'Unable to load communications.'), 'error', 'Communications unavailable');
    } finally {
      setLoading(false);
    }
  }

  async function resend(id: number) {
    try {
      await api.post(`/registration/staff/communications/${id}/resend`, {});
      showAlert('The email was resent without changing registration state.', 'success', 'Email resent');
      await loadCommunications();
    } catch (error) {
      showAlert(getApiErrorMessage(error, 'Unable to resend email.'), 'error', 'Resend failed');
    }
  }

  return (
    <Layout>
      <AppPage>
        <AppPageHeader
          title="Registration communications"
          description="View and resend registration emails without creating duplicate offers, payment orders, or registration actions."
        />

        <section className="app-card space-y-4">
          <h2 className="app-section-title">Find communications</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-1">
              <span className="app-label">Registration ID</span>
              <input className="app-input" value={registrationId} onChange={(event) => setRegistrationId(event.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="app-label">Waitlist offer ID</span>
              <input className="app-input" value={waitlistOfferId} onChange={(event) => setWaitlistOfferId(event.target.value)} />
            </label>
            <div className="flex items-end">
              <Button onClick={() => void loadCommunications()} disabled={loading}>
                {loading ? 'Loading' : 'Load communications'}
              </Button>
            </div>
          </div>
        </section>

        <section className="app-card space-y-4">
          <h2 className="app-section-title">History</h2>
          {communications.length === 0 ? <p className="text-sm text-gray-600 dark:text-gray-300">No communications loaded.</p> : null}
          <div className="space-y-3">
            {communications.map((communication) => (
              <div key={communication.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="font-medium">{communication.subject}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      {label(communication.messageType)} · {communication.recipientEmail} · {label(communication.deliveryStatus)}
                    </p>
                    {communication.errorDetail ? <p className="text-sm text-red-600">{communication.errorDetail}</p> : null}
                  </div>
                  <Button variant="secondary" onClick={() => void resend(communication.id)}>Resend</Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </AppPage>
    </Layout>
  );
}
