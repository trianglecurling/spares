import { useEffect, useState } from 'react';
import { get } from '../../api/client';
import InlineStateMessage from '../InlineStateMessage';
import MemberCredentialsList, { type MemberCredentialItem } from '../MemberCredentialsList';
import { useAuth } from '../../contexts/AuthContext';

export default function ProfileCredentialsTab() {
  const { member } = useAuth();
  const [credentials, setCredentials] = useState<MemberCredentialItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!member?.id) {
      setLoading(false);
      setError(true);
      return;
    }

    let canceled = false;
    const load = async () => {
      setLoading(true);
      setError(false);
      try {
        const res = await get('/members/{memberId}/volunteer-credentials', undefined, {
          memberId: String(member.id),
        });
        if (!canceled) {
          setCredentials(res.credentials ?? []);
        }
      } catch {
        if (!canceled) {
          setCredentials(null);
          setError(true);
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      canceled = true;
    };
  }, [member?.id]);

  if (loading) {
    return <InlineStateMessage title="Loading credentials…" />;
  }

  if (error || credentials == null) {
    return <InlineStateMessage title="Unable to load credentials." />;
  }

  if (credentials.length === 0) {
    return (
      <InlineStateMessage
        title="You do not hold any credentials."
        description="If you need a credential, contact the point of contact listed for that credential."
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Credentials you currently hold, including any that have expired.
      </p>
      <MemberCredentialsList credentials={credentials} />
    </div>
  );
}
