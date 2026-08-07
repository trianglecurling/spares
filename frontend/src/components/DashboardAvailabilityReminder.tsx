import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { HiOutlineInformationCircle, HiXMark } from 'react-icons/hi2';
import Button from './Button';
import { useAuth } from '../contexts/AuthContext';
import api, { getApiErrorMessage } from '../utils/api';

type AvailabilityReminderPayload = {
  visible: boolean;
  session: { id: number; name: string } | null;
};

export default function DashboardAvailabilityReminder() {
  const { member } = useAuth();
  const [data, setData] = useState<AvailabilityReminderPayload | null>(null);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    if (!member?.id || member.socialMember) {
      setData(null);
      return;
    }

    let canceled = false;

    async function load() {
      try {
        const response = await api.get<AvailabilityReminderPayload>('/availability/reminder');
        if (!canceled) setData(response.data);
      } catch (err) {
        if (!canceled) {
          console.error(getApiErrorMessage(err, 'Unable to load availability reminder.'));
          setData(null);
        }
      }
    }

    void load();
    return () => {
      canceled = true;
    };
  }, [member?.id, member?.socialMember]);

  const dismiss = async () => {
    if (dismissing) return;
    setDismissing(true);
    // Optimistic hide
    setData((prev) => (prev ? { ...prev, visible: false } : prev));
    try {
      await api.post('/availability/reminder/ack');
    } catch (err) {
      console.error(getApiErrorMessage(err, 'Unable to dismiss availability reminder.'));
      // Reload so a failed ack does not permanently hide the reminder in this session
      try {
        const response = await api.get<AvailabilityReminderPayload>('/availability/reminder');
        setData(response.data);
      } catch {
        setData(null);
      }
    } finally {
      setDismissing(false);
    }
  };

  if (!data?.visible || !data.session) return null;

  const sessionName = data.session.name;

  return (
    <div
      className="app-alert border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-100"
      role="status"
    >
      <div className="flex items-start gap-3">
        <HiOutlineInformationCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-3 sm:space-y-0 sm:flex sm:items-center sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <p className="font-semibold">Update your sparing availability</p>
            <p className="mt-1">
              A new session ({sessionName}) is underway. Review your league availability so spare
              requests match when you can play.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            <Link to="/availability">
              <Button>Update availability</Button>
            </Link>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void dismiss();
              }}
              disabled={dismissing}
              aria-label="Dismiss sparing availability reminder"
            >
              <span className="inline-flex items-center gap-1.5">
                <HiXMark className="h-4 w-4" aria-hidden="true" />
                Dismiss
              </span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
