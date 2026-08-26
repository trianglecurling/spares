import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAlert } from '../contexts/AlertContext';
import Button from './Button';
import { getApiErrorMessage } from '../utils/api';

export default function DeveloperSessionBanner() {
  const { developerSession, member, memberDisplayName, returnFromDeveloperSession } = useAuth();
  const { showAlert } = useAlert();
  const [returning, setReturning] = useState(false);

  useEffect(() => {
    setReturning(false);
  }, [developerSession?.operatorMemberId, developerSession?.targetMemberId]);

  if (!developerSession) return null;

  const signedInName = member?.name || memberDisplayName || developerSession.targetName;

  const handleReturn = async () => {
    setReturning(true);
    try {
      await returnFromDeveloperSession();
    } catch (error: unknown) {
      showAlert(getApiErrorMessage(error, 'Could not return to your account'), 'error');
    } finally {
      setReturning(false);
    }
  };

  return (
    <div className="app-alert-warning rounded-none border-x-0 border-t-0" role="status">
      <div className="public-container flex flex-col gap-3 py-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0">
          Signed in as <span className="font-medium">{signedInName}</span> for investigation
        </p>
        <Button
          type="button"
          variant="secondary"
          className="shrink-0"
          onClick={() => {
            void handleReturn();
          }}
          disabled={returning}
        >
          {returning ? 'Returning...' : 'Return to your account'}
        </Button>
      </div>
    </div>
  );
}
