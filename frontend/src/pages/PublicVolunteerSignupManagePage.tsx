import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Button from '../components/Button';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import SeoMeta from '../components/SeoMeta';
import { useAlert } from '../contexts/AlertContext';
import { useConfirm } from '../contexts/ConfirmContext';
import api, { formatApiError } from '../utils/api';
import {
  formatVolunteerRange,
  type PublicVolunteerSignupManageView,
} from '../utils/volunteering';

export default function PublicVolunteerSignupManagePage() {
  const { accessToken } = useParams<{ accessToken: string }>();
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [signup, setSignup] = useState<PublicVolunteerSignupManageView | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    if (!accessToken) {
      setNotFound(true);
      setSignup(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setNotFound(false);
    try {
      const res = await api.get<{ signup: PublicVolunteerSignupManageView }>(
        `/public/volunteering/signups/manage/${encodeURIComponent(accessToken)}`
      );
      setSignup(res.data.signup);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        setNotFound(true);
        setSignup(null);
      } else {
        showAlert(formatApiError(err, 'Failed to load signup'), 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [accessToken, showAlert]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCancel = async () => {
    if (!accessToken || !signup) return;
    const ok = await confirm({
      title: 'Cancel signup',
      message: `Cancel your signup for ${signup.roleName}?`,
      variant: 'danger',
    });
    if (!ok) return;
    setCancelling(true);
    try {
      await api.post(
        `/public/volunteering/signups/manage/${encodeURIComponent(accessToken)}/cancel`
      );
      showAlert('Signup cancelled.', 'success');
      await load();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to cancel signup'), 'error');
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <PublicLayout>
        <SeoMeta title="Manage volunteer signup" />
        <PublicStateCard title="Loading signup" description="Fetching your volunteer signup details." />
      </PublicLayout>
    );
  }

  if (notFound || !signup) {
    return (
      <PublicLayout>
        <SeoMeta title="Manage volunteer signup" />
        <PublicStateCard
          title="Signup not found"
          description="This manage link is invalid or no longer available."
        />
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <SeoMeta title={`Manage signup · ${signup.programTitle}`} />
      <div className="mx-auto max-w-xl space-y-6 px-4 py-8 sm:px-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold text-gray-900">Your volunteer signup</h1>
          <p className="text-gray-600">{signup.programTitle}</p>
        </header>

        <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-5 text-sm text-gray-700">
          <p>
            <span className="font-medium text-gray-900">Role:</span> {signup.roleName}
          </p>
          <p>
            <span className="font-medium text-gray-900">When:</span>{' '}
            {formatVolunteerRange(signup.startDt, signup.endDt)}
          </p>
          {signup.location ? (
            <p>
              <span className="font-medium text-gray-900">Where:</span> {signup.location}
            </p>
          ) : null}
          <p>
            <span className="font-medium text-gray-900">Name:</span> {signup.guestName}
          </p>
          <p>
            <span className="font-medium text-gray-900">Email:</span> {signup.guestEmail}
          </p>
          {signup.comments ? (
            <p>
              <span className="font-medium text-gray-900">Comments:</span>{' '}
              <span className="whitespace-pre-wrap">{signup.comments}</span>
            </p>
          ) : null}
          <p>
            <span className="font-medium text-gray-900">Status:</span>{' '}
            {signup.status === 'confirmed' ? 'Confirmed' : 'Cancelled'}
          </p>
        </div>

        {signup.status === 'cancelled' ? (
          <p className="text-sm text-gray-600">This signup has been cancelled.</p>
        ) : signup.canCancel ? (
          <Button type="button" variant="danger" disabled={cancelling} onClick={() => void handleCancel()}>
            {cancelling ? 'Cancelling…' : 'Cancel signup'}
          </Button>
        ) : (
          <p className="text-sm text-gray-600">
            This shift has already started, so the signup can no longer be cancelled online.
          </p>
        )}
      </div>
    </PublicLayout>
  );
}
