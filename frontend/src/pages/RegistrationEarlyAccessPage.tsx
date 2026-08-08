import { FormEvent, useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import FormField from '../components/FormField';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import SeoMeta from '../components/SeoMeta';
import Button from '../components/Button';
import axios from 'axios';
import api, { formatApiError } from '../utils/api';
import { storeRegistrationEarlyAccessUnlockToken } from '../utils/registrationEarlyAccess';

function unlockErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const details = error.response?.data?.details;
    if (details && typeof details === 'object' && details !== null) {
      const passwordError = (details as Record<string, unknown>).password;
      if (typeof passwordError === 'string' && passwordError.trim()) {
        return passwordError.trim();
      }
    }
  }
  return formatApiError(error, 'Unable to unlock early access.');
}

type EarlyAccessStatus = {
  available: boolean;
  registrationState: 'closed' | 'priority' | 'open';
  earlyAccessPath: string;
};

type UnlockResponse = {
  unlockToken: string;
  expiresAt: string;
};

export default function RegistrationEarlyAccessPage() {
  const navigate = useNavigate();
  const passwordId = useId();
  const [status, setStatus] = useState<EarlyAccessStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<EarlyAccessStatus>('/registration/early-access/status')
      .then((response) => {
        if (!cancelled) setStatus(response.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(formatApiError(err, 'Unable to check early access status.'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await api.post<UnlockResponse>('/registration/early-access/unlock', {
        password,
      });
      storeRegistrationEarlyAccessUnlockToken(response.data.unlockToken);
      navigate('/registration/start', { replace: true });
    } catch (err: unknown) {
      setError(unlockErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PublicLayout>
      <SeoMeta title="Early registration access" description="Unlock early curling registration access." />
      <div className="mx-auto max-w-lg px-4 py-10">
        {loading ? (
          <PublicStateCard title="Checking early access…" />
        ) : error && !status ? (
          <PublicStateCard title="Unable to load early access" description={error} />
        ) : status?.registrationState === 'priority' || status?.registrationState === 'open' ? (
          <div className="space-y-4">
            <h1 className="text-3xl font-bold text-[#121033]">Registration is already open</h1>
            <p className="text-gray-600">
              Priority or open registration has already started, so an early-access password is not needed.
            </p>
            <Link to="/registration/start">
              <Button>Continue to registration</Button>
            </Link>
          </div>
        ) : !status?.available ? (
          <div className="space-y-4">
            <h1 className="text-3xl font-bold text-[#121033]">Early access unavailable</h1>
            <p className="text-gray-600">
              Early registration access is not enabled right now. If you were given this link, check with club staff.
            </p>
            <Link to="/">
              <Button variant="secondary">Back to home</Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <h1 className="text-3xl font-bold text-[#121033]">Early registration access</h1>
            <p className="text-gray-600">
              Enter the early-access password to begin priority registration before it opens for everyone.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <FormField label="Password" htmlFor={passwordId} required tone="public">
                <input
                  id={passwordId}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="app-input"
                />
              </FormField>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <Button type="submit" disabled={!password.trim() || submitting}>
                {submitting ? 'Checking…' : 'Unlock registration'}
              </Button>
            </form>
          </div>
        )}
      </div>
    </PublicLayout>
  );
}
