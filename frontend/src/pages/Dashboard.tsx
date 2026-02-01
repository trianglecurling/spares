import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  HiOutlineUserPlus,
  HiOutlineCalendar,
  HiOutlineInbox,
  HiOutlineMegaphone,
  HiOutlineInformationCircle,
  HiOutlineExclamationTriangle,
  HiOutlineCheckCircle,
  HiOutlineXCircle,
} from 'react-icons/hi2';
import axios from 'axios';
import Layout from '../components/Layout';
import api, { formatApiError } from '../utils/api';
import Modal from '../components/Modal';
import Button from '../components/Button';
import NotificationModal from '../components/NotificationModal';
import { useAlert } from '../contexts/AlertContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { useAuth } from '../contexts/AuthContext';
import { formatPhone } from '../utils/phone';
import { renderMe } from '../utils/me';

interface SpareRequest {
  id: number;
  requesterName: string;
  requesterEmail?: string;
  requesterPhone?: string;
  requestedForName: string;
  gameDate: string;
  gameTime: string;
  leagueName?: string | null;
  position?: string;
  message?: string;
  requestType: string;
  inviteStatus?: 'pending' | 'declined';
  createdAt: string;
  filledByName?: string;
  status?: string;
  filledAt?: string;
}

interface MySpareRequest {
  id: number;
  requestedForName: string;
  requestedForMemberId?: number | null;
  requesterId?: number | null;
  requesterName?: string | null;
  gameDate: string;
  gameTime: string;
  leagueName?: string | null;
  position?: string;
  message?: string;
  requestType: string;
  status: string;
  filledByName?: string;
  filledByEmail?: string;
  filledByPhone?: string;
  filledAt?: string;
  sparerComment?: string;
}

export default function Dashboard() {
  const { member } = useAuth();
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [openRequests, setOpenRequests] = useState<SpareRequest[]>([]);
  const [mySparing, setMySparing] = useState<SpareRequest[]>([]);
  const [filledRequests, setFilledRequests] = useState<SpareRequest[]>([]);
  const [ccRequests, setCcRequests] = useState<SpareRequest[]>([]);
  const [myRequests, setMyRequests] = useState<MySpareRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFilled, setShowFilled] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<SpareRequest | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [declineRequest, setDeclineRequest] = useState<SpareRequest | null>(null);
  const [declineComment, setDeclineComment] = useState('');
  const [declining, setDeclining] = useState(false);
  const [cancelRequest, setCancelRequest] = useState<SpareRequest | null>(null);
  const [cancelComment, setCancelComment] = useState('');
  const [canceling, setCanceling] = useState(false);
  const [notification, setNotification] = useState<{
    isOpen: boolean;
    message: string;
    variant: 'success' | 'error';
  }>({ isOpen: false, message: '', variant: 'success' });
  const [dashboardAlert, setDashboardAlert] = useState<{
    title?: string;
    body?: string;
    variant?: string;
    icon?: string;
  } | null>(null);

  const dashboardAlertStyles = (variant?: string) => {
    switch (variant) {
      case 'success':
        return {
          container: 'border-l-4 border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30',
          text: 'text-emerald-900 dark:text-emerald-100',
        };
      case 'danger':
        return {
          container: 'border-l-4 border-rose-500 bg-rose-50 dark:bg-rose-900/30',
          text: 'text-rose-900 dark:text-rose-100',
        };
      case 'warning':
        return {
          container: 'border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-900/30',
          text: 'text-amber-900 dark:text-amber-100',
        };
      default:
        return {
          container: 'border-l-4 border-sky-500 bg-sky-50 dark:bg-sky-900/30',
          text: 'text-sky-900 dark:text-sky-100',
        };
    }
  };

  const renderDashboardAlertIcon = (icon?: string, className?: string) => {
    const sharedProps = { className: `${className ?? ''} h-6 w-6` };
    switch (icon) {
      case 'none':
        return null;
      case 'info':
        return <HiOutlineInformationCircle {...sharedProps} />;
      case 'warning':
        return <HiOutlineExclamationTriangle {...sharedProps} />;
      case 'success':
        return <HiOutlineCheckCircle {...sharedProps} />;
      case 'error':
        return <HiOutlineXCircle {...sharedProps} />;
      case 'announcement':
      default:
        return <HiOutlineMegaphone {...sharedProps} />;
    }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  useEffect(() => {
    const loadDashboardAlert = async () => {
      try {
        const response = await api.get('/public-config');
        const title = (response.data?.dashboardAlertTitle as string | null) || '';
        const body = (response.data?.dashboardAlertBody as string | null) || '';
        const variant = (response.data?.dashboardAlertVariant as string | null) || 'info';
        const icon = (response.data?.dashboardAlertIcon as string | null) || 'announcement';
        const expiresAtRaw = response.data?.dashboardAlertExpiresAt as string | null | undefined;
        const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;
        const isExpired = expiresAt ? expiresAt.getTime() <= Date.now() : false;
        if ((title.trim() || body.trim()) && !isExpired) {
          setDashboardAlert({ title: title.trim(), body: body.trim(), variant, icon });
        } else {
          setDashboardAlert(null);
        }

      } catch (error) {
        console.error('Failed to load dashboard alert:', error);
      }
    };

    loadDashboardAlert();
  }, []);

  // Check for requestId in URL and open dialog when data is loaded
  useEffect(() => {
    const requestIdParam = searchParams.get('requestId');
    if (requestIdParam && !loading) {
      const requestId = parseInt(requestIdParam, 10);
      
      // Check if user has already responded to this request
      const alreadyResponded = mySparing.some(r => r.id === requestId);
      if (alreadyResponded) {
        showAlert('You are already signed up for this spare request.', 'error');
        // Clear the requestId from URL
        searchParams.delete('requestId');
        setSearchParams(searchParams, { replace: true });
        return;
      }
      
      // Find the request in open requests
      const request = openRequests.find(r => r.id === requestId);
      if (request) {
        setSelectedRequest(request);
        // Clear the requestId from URL
        searchParams.delete('requestId');
        setSearchParams(searchParams, { replace: true });
      } else {
        // If the request isn't in the open list, it was likely filled/cancelled/deleted already.
        // Ask the backend for the status so we can show a specific message.
        (async () => {
          try {
            const res = await api.get(`/spares/${requestId}/status`);
            const status = (res.data?.status as string | undefined) || 'unknown';

            const message =
              status === 'filled'
                ? 'Sorry, this spare request has already been filled. See your dashboard for any unfilled spare requests.'
                : 'Sorry, this spare request has been deleted and is no longer available. See your dashboard for any unfilled spare requests.';

            setNotification({ isOpen: true, message, variant: 'error' });
          } catch (error: unknown) {
            const status = axios.isAxiosError(error) ? error.response?.status : undefined;
            // 404 -> deleted; 403 -> not available to this user (treat as deleted for UX)
            if (status === 404 || status === 403) {
              setNotification({
                isOpen: true,
                message:
                  'Sorry, this spare request has been deleted and is no longer available. See your dashboard for any unfilled spare requests.',
                variant: 'error',
              });
            } else {
              setNotification({
                isOpen: true,
                message:
                  'Sorry, we could not load that spare request. See your dashboard for any unfilled spare requests.',
                variant: 'error',
              });
            }
          } finally {
            searchParams.delete('requestId');
            setSearchParams(searchParams, { replace: true });
          }
        })();
      }
    }
  }, [loading, openRequests, mySparing, searchParams, setSearchParams, showAlert]);

  // Check for declineRequestId in URL and open decline dialog when data is loaded
  useEffect(() => {
    const declineIdParam = searchParams.get('declineRequestId');
    if (declineIdParam && !loading) {
      const requestId = parseInt(declineIdParam, 10);
      const request = openRequests.find(r => r.id === requestId);
      if (request) {
        if (request.requestType !== 'private') {
          showAlert('Decline is only available for private spare requests.', 'error');
        } else {
          setDeclineRequest(request);
        }
      } else {
        showAlert('Spare request not found (it may no longer be available).', 'error');
      }
      searchParams.delete('declineRequestId');
      setSearchParams(searchParams, { replace: true });
    }
  }, [loading, openRequests, searchParams, setSearchParams, showAlert]);

  const loadAllData = async () => {
    try {
      const [openRes, mySparingRes, filledRes, ccRes, myRequestsRes] = await Promise.all([
        api.get('/spares'),
        api.get('/spares/my-sparing'),
        api.get('/spares/filled-upcoming'),
        api.get('/spares/cc'),
        api.get('/spares/my-requests'),
      ]);
      setOpenRequests(openRes.data);
      setMySparing(mySparingRes.data);
      setFilledRequests(filledRes.data);
      setCcRequests(ccRes.data || []);
      // Filter out cancelled requests - only show open and filled
      setMyRequests(myRequestsRes.data.filter((r: MySpareRequest) => r.status !== 'cancelled'));
    } catch (error) {
      console.error('Failed to load spare requests:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRespond = async () => {
    if (!selectedRequest) return;

    const mustProvideComment =
      selectedRequest.requestType === 'private' && selectedRequest.inviteStatus === 'declined';
    if (mustProvideComment && !comment.trim()) {
      showAlert(
        'Please include a message when accepting after previously declining this private request.',
        'warning'
      );
      return;
    }

    setSubmitting(true);
    try {
      await api.post(`/spares/${selectedRequest.id}/respond`, {
        comment: comment.trim() || undefined,
      });

      // Reload all data
      await loadAllData();
      setSelectedRequest(null);
      setComment('');
      
      // Show success notification
      setNotification({
        isOpen: true,
        message: `You've successfully signed up to spare for ${selectedRequest.requestedForName}!`,
        variant: 'success',
      });

      // If this user just came through first-login via a spare accept link, optionally prompt them
      // to set their availability after they've successfully accepted.
      try {
        const shouldSuggest = sessionStorage.getItem('postFirstLoginSuggestAvailability') === '1';
        if (shouldSuggest) {
          sessionStorage.removeItem('postFirstLoginSuggestAvailability');
          const go = await confirm({
            title: 'Set your availability?',
            message:
              "Want to set your sparing availability now so others can find you for future spare requests?",
            confirmText: 'Set availability',
            cancelText: 'Not now',
            variant: 'info',
          });
          if (go) {
            navigate('/availability');
          }
        }
      } catch {
        // ignore
      }
    } catch (error: unknown) {
      console.error('Failed to respond to spare request:', error);

      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const data = axios.isAxiosError(error) ? (error.response?.data as { error?: string } | undefined) : undefined;

      // Check for specific error cases
      if (status === 404) {
        setNotification({
          isOpen: true,
          message: 'This spare request has been deleted and is no longer available.',
          variant: 'error',
        });
        // Reload data to remove the deleted request from the list
        await loadAllData();
        setSelectedRequest(null);
        setComment('');
      } else if (status === 400) {
        const errorMessage = data?.error || 'This spare request is no longer open.';
        setNotification({
          isOpen: true,
          message: errorMessage,
          variant: 'error',
        });
        // Reload data to update the request status
        await loadAllData();
        setSelectedRequest(null);
        setComment('');
      } else {
        setNotification({
          isOpen: true,
          message: formatApiError(error, 'Failed to respond'),
          variant: 'error',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelSparing = async () => {
    if (!cancelRequest) return;

    if (!cancelComment.trim()) {
      showAlert('Please provide a comment explaining why you are canceling.', 'warning');
      return;
    }

    setCanceling(true);
    try {
      await api.post(`/spares/${cancelRequest.id}/cancel-sparing`, {
        comment: cancelComment,
      });

      // Reload all data
      await loadAllData();
      setCancelRequest(null);
      setCancelComment('');
      
      // Show success notification
      setNotification({
        isOpen: true,
        message: `You've successfully canceled sparing for ${cancelRequest.requestedForName}.`,
        variant: 'success',
      });
    } catch (error) {
      console.error('Failed to cancel sparing:', error);
      setNotification({
        isOpen: true,
        message: formatApiError(error, 'Failed to cancel sparing'),
        variant: 'error',
      });
    } finally {
      setCanceling(false);
    }
  };

  const handleDecline = async () => {
    if (!declineRequest) return;
    if (declineRequest.requestType !== 'private') {
      showAlert('Decline is only available for private spare requests.', 'error');
      return;
    }

    setDeclining(true);
    try {
      await api.post(`/spares/${declineRequest.id}/decline`, {
        comment: declineComment.trim() || undefined,
      });

      await loadAllData();
      setDeclineRequest(null);
      setDeclineComment('');
      setNotification({
        isOpen: true,
        message: `You declined the private spare request for ${declineRequest.requestedForName}.`,
        variant: 'success',
      });

      // If this user just came through first-login via a decline link, optionally prompt them
      // to set their availability after they've declined.
      try {
        const shouldSuggest = sessionStorage.getItem('postFirstLoginSuggestAvailability') === '1';
        if (shouldSuggest) {
          sessionStorage.removeItem('postFirstLoginSuggestAvailability');
          const go = await confirm({
            title: 'Set your availability?',
            message:
              "Want to set your sparing availability now so others can find you for future spare requests?",
            confirmText: 'Set availability',
            cancelText: 'Not now',
            variant: 'info',
          });
          if (go) {
            navigate('/availability');
          }
        }
      } catch {
        // ignore
      }
    } catch (error: unknown) {
      console.error('Failed to decline spare request:', error);
      setNotification({
        isOpen: true,
        message: formatApiError(error, 'Failed to decline'),
        variant: 'error',
      });
    } finally {
      setDeclining(false);
    }
  };

  // Note: cancelling / managing spare requests is handled on the My Requests page (/my-requests).

  const formatDate = (dateStr: string) => {
    // Parse date string as local date to avoid timezone issues
    // dateStr is in YYYY-MM-DD format from the database
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day); // month is 0-indexed
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatTime = (timeStr: string) => {
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const filledBadge = (
    <span className="px-2 py-1 rounded text-sm font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200">
      Filled
    </span>
  );

  const statusBadge = (status?: string) => {
    if (status === 'filled') return filledBadge;
    if (status === 'cancelled') {
      return (
        <span className="px-2 py-1 rounded text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
          Cancelled
        </span>
      );
    }
    return (
      <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 px-2 py-1 rounded text-sm font-medium">
        Open
      </span>
    );
  };

  const requestTypeBadge = (requestType?: string) => {
    if (requestType === 'private') {
      return (
        <span className="px-2 py-1 rounded text-sm font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200">
          Private
        </span>
      );
    }
    if (requestType === 'public') {
      return (
        <span className="px-2 py-1 rounded text-sm font-medium bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-200">
          Public
        </span>
      );
    }
    return null;
  };

  const renderRequestCard = (request: SpareRequest, showButton = true, showMessage = true, showCancelButton = false) => {
    const isPrivateInviteDeclined = request.requestType === 'private' && request.inviteStatus === 'declined';

    return (
    <div key={request.id} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <div className="flex items-center space-x-2 mb-2">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Spare needed for {renderMe(request.requestedForName, member?.name)}
            </h3>
            {showButton && (
              <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 px-2 py-1 rounded text-sm font-medium">
                Open
              </span>
            )}
            {requestTypeBadge(request.requestType)}
            {request.position && (
              <span className="bg-primary-teal text-white px-2 py-1 rounded text-sm">
                {request.position}
              </span>
            )}
          </div>

          <div className="text-gray-600 dark:text-gray-400 space-y-1">
            <p>
              <span className="font-medium dark:text-gray-300">When:</span> {formatDate(request.gameDate)}{' '}
              at {formatTime(request.gameTime)}
              {request.leagueName ? <span> • {request.leagueName}</span> : null}
            </p>
            <p>
              <span className="font-medium dark:text-gray-300">Requested by:</span>{' '}
              {renderMe(request.requesterName, member?.name)}
            </p>
            {request.requesterEmail && (
              <p className="text-sm ml-4">
                <a href={`mailto:${request.requesterEmail}`} className="text-primary-teal hover:underline">
                  {request.requesterEmail}
                </a>
              </p>
            )}
            {request.requesterPhone && (
              <p className="text-sm ml-4">
                <a href={`tel:${request.requesterPhone.replace(/\D/g, '')}`} className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200">
                  {formatPhone(request.requesterPhone)}
                </a>
              </p>
            )}
            {request.filledByName && (
              <p>
                <span className="font-medium dark:text-gray-300">Filled by:</span>{' '}
                {renderMe(request.filledByName, member?.name)}
              </p>
            )}
            {showMessage && request.message && (
              <p className="italic mt-2">"{request.message}"</p>
            )}
          </div>
        </div>

        <div className="flex flex-row flex-wrap gap-2 ml-4 justify-end">
          {showButton && request.requestType === 'private' && isPrivateInviteDeclined && (
            <span className="px-3 py-2 rounded-md text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
              Declined
            </span>
          )}
          {showButton && (
            <Button onClick={() => setSelectedRequest(request)}>
              {isPrivateInviteDeclined ? 'Sign Up Anyway' : 'Sign Up'}
            </Button>
          )}
          {showButton && request.requestType === 'private' && !isPrivateInviteDeclined && (
            <Button
              variant="secondary"
              onClick={() => {
                setDeclineRequest(request);
                setDeclineComment('');
              }}
            >
              Decline
            </Button>
          )}
          {showCancelButton && (
            <Button
              variant="danger"
              onClick={() => setCancelRequest(request)}
            >
              Cancel sparing
            </Button>
          )}
        </div>
      </div>
    </div>
    );
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold text-[#121033] dark:text-gray-100">
            Dashboard
          </h1>
        </div>

        {dashboardAlert && (() => {
          const styles = dashboardAlertStyles(dashboardAlert.variant);
          return (
            <div className={`${styles.container} p-4 rounded shadow-sm`}>
              <div className="flex items-start gap-3">
                {dashboardAlert.icon !== 'none' && (
                  <div className={`${styles.text} mt-0.5`}>
                    {renderDashboardAlertIcon(dashboardAlert.icon, styles.text)}
                  </div>
                )}
                <div>
                  {dashboardAlert.title && (
                    <div className={`text-lg font-semibold ${styles.text}`}>
                      {dashboardAlert.title}
                    </div>
                  )}
                  {dashboardAlert.body && (
                    <div className={`text-sm whitespace-pre-line mt-1 ${styles.text}`}>
                      {dashboardAlert.body}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {!member?.spareOnly && (
            <Link
              to="/request-spare"
              className="border-2 border-primary-orange text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-800 p-6 rounded-lg hover:bg-primary-orange hover:text-white dark:hover:bg-primary-orange transition-colors text-center"
            >
              <div className="flex justify-center mb-2">
                <HiOutlineUserPlus className="w-12 h-12" />
              </div>
              <div className="text-xl font-semibold">Request a spare</div>
              <div className="text-sm mt-1 dark:text-gray-300">Need someone to fill in for your game?</div>
            </Link>
          )}

          <Link
            to="/availability"
            className="border-2 border-primary-teal text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-800 p-6 rounded-lg hover:bg-primary-teal hover:text-white dark:hover:bg-primary-teal transition-colors text-center"
          >
            <div className="flex justify-center mb-2">
              <HiOutlineCalendar className="w-12 h-12" />
            </div>
            <div className="text-xl font-semibold">Set your availability</div>
            <div className="text-sm mt-1 dark:text-gray-300">Let others know when you can spare</div>
          </Link>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading...</div>
        ) : (
          <div className="space-y-6">
            {/* My Upcoming Sparing */}
            {mySparing.length > 0 && (
              <div>
                <h2 className="text-xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                  My upcoming sparing
                </h2>
                <div className="space-y-4">
                  {mySparing.map((request) => renderRequestCard(request, false, true, true))}
                </div>
              </div>
            )}

            {/* My Spare Requests */}
            {myRequests.length > 0 && (
              <div>
                <h2 className="text-xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                  My spare requests{' '}
                  <Link
                    to="/my-requests"
                    className="text-sm font-normal text-primary-teal hover:underline"
                  >
                    (manage)
                  </Link>
                </h2>
                <div className="space-y-4">
                  {myRequests.map((request) => (
                    <div key={request.id} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-2">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                        Spare for {renderMe(request.requestedForName, member?.name)}
                            </h3>
                            {request.status === 'open' && (
                              <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 px-2 py-1 rounded text-sm font-medium">
                          Unfilled
                              </span>
                            )}
                            {request.status === 'filled' && (
                              <span className="bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 px-2 py-1 rounded text-sm font-medium">
                                Filled
                              </span>
                            )}
                            {requestTypeBadge(request.requestType)}
                            {request.position && (
                              <span className="bg-primary-teal text-white px-2 py-1 rounded text-sm">
                                {request.position}
                              </span>
                            )}
                          </div>

                          <div className="text-gray-600 dark:text-gray-400 space-y-1">
                            <p>
                              <span className="font-medium dark:text-gray-300">When:</span> {formatDate(request.gameDate)}{' '}
                              at {formatTime(request.gameTime)}
                              {request.leagueName ? <span> • {request.leagueName}</span> : null}
                            </p>
                          {request.requesterId && request.requesterId !== member?.id && request.requesterName && (
                            <p>
                              <span className="font-medium dark:text-gray-300">Requested by:</span>{' '}
                              {renderMe(request.requesterName, member?.name)}
                            </p>
                          )}
                            {request.message && (
                              <p className="italic mt-2">"{request.message}"</p>
                            )}
                            {request.status === 'filled' && request.filledByName && (
                              <>
                                <p className="text-green-700 dark:text-green-400 font-medium mt-2">
                                  ✓ Filled by {renderMe(request.filledByName, member?.name)}
                                </p>
                                {request.filledByEmail && (
                                  <p className="text-sm ml-4 mt-1">
                                    <a href={`mailto:${request.filledByEmail}`} className="text-primary-teal hover:underline">
                                      {request.filledByEmail}
                                    </a>
                                  </p>
                                )}
                                {request.filledByPhone && (
                                  <p className="text-sm ml-4 mt-1">
                                    <a href={`tel:${request.filledByPhone.replace(/\D/g, '')}`} className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200">
                                      {formatPhone(request.filledByPhone)}
                                    </a>
                                  </p>
                                )}
                              </>
                            )}
                            {request.status === 'filled' && request.sparerComment && (
                              <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-md">
                                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                  Message from {renderMe(request.filledByName, member?.name)}:
                                </p>
                                <p className="text-sm text-gray-600 dark:text-gray-400 italic">"{request.sparerComment}"</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Requests I've been CC'd on */}
            {ccRequests.length > 0 && (
              <div>
                <h2 className="text-xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                  Requests I've been CC&apos;d on
                </h2>
                <div className="space-y-4">
                  {ccRequests.map((request) => (
                    <div key={request.id} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                      <div className="flex justify-between items-start gap-4">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-2 flex-wrap">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                              Spare for {renderMe(request.requestedForName, member?.name)}
                            </h3>
                            {statusBadge(request.status)}
                            {requestTypeBadge(request.requestType)}
                            {request.position && (
                              <span className="bg-primary-teal text-white px-2 py-1 rounded text-sm">
                                {request.position}
                              </span>
                            )}
                          </div>

                          <div className="text-gray-600 dark:text-gray-400 space-y-1">
                            <p>
                              <span className="font-medium dark:text-gray-300">When:</span> {formatDate(request.gameDate)} at{' '}
                              {formatTime(request.gameTime)}
                              {request.leagueName ? <span> • {request.leagueName}</span> : null}
                            </p>
                            <p>
                              <span className="font-medium dark:text-gray-300">Requested by:</span>{' '}
                              {renderMe(request.requesterName, member?.name)}
                            </p>
                            {request.filledByName && (
                              <p>
                                <span className="font-medium dark:text-gray-300">Filled by:</span>{' '}
                                {renderMe(request.filledByName, member?.name)}
                              </p>
                            )}
                            {request.message ? <p className="italic mt-2">"{request.message}"</p> : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Outstanding Spare Requests */}
            <div>
              <h2 className="text-xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                Outstanding spare requests
              </h2>
              {openRequests.length === 0 ? (
                <div className="text-center py-8 bg-white dark:bg-gray-800 rounded-lg shadow">
                  <div className="flex justify-center mb-2">
                    <HiOutlineInbox className="w-12 h-12 text-gray-400 dark:text-gray-500" />
                  </div>
                  <p className="text-gray-600 dark:text-gray-400">
                    No open spare requests at the moment. Check back later!
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {openRequests.map((request) => renderRequestCard(request, true))}
                </div>
              )}
            </div>

            {/* Filled Spare Requests */}
            {filledRequests.length > 0 && (
              <div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowFilled(!showFilled)}
                    className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                    aria-expanded={showFilled}
                  >
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      Filled spare requests
                    </h2>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {showFilled ? '▼' : '▶'} {filledRequests.length}
                    </span>
                  </button>

                  {showFilled && (
                    <div className="border-t border-gray-200 dark:border-gray-700 px-5 py-4">
                      <div className="divide-y divide-gray-200 dark:divide-gray-700">
                        {filledRequests.map((request) => (
                          <div key={request.id} className="py-3 flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                  {formatDate(request.gameDate)} • {formatTime(request.gameTime)}
                                  {request.leagueName ? ` • ${request.leagueName}` : ''}
                                </span>
                                {filledBadge}
                                {requestTypeBadge(request.requestType)}
                                {request.position && (
                                  <span className="text-xs px-2 py-0.5 rounded bg-primary-teal text-white">
                                    {request.position}
                                  </span>
                                )}
                              </div>
                              <div className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                                Spare for{' '}
                                <span className="font-medium dark:text-gray-300">
                                  {renderMe(request.requestedForName, member?.name)}
                                </span>
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                Requested by {renderMe(request.requesterName, member?.name)}
                                {request.filledByName ? ` • Filled by ${renderMe(request.filledByName, member?.name)}` : ''}
                              </div>
                            </div>

                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <Modal
        isOpen={!!selectedRequest}
        onClose={() => {
          setSelectedRequest(null);
          setComment('');
        }}
        title="Confirm spare"
      >
        {selectedRequest && (
          <div className="space-y-4">
            <p className="text-gray-700 dark:text-gray-300">
              You're signing up to spare for <strong>{selectedRequest.requestedForName}</strong> on{' '}
              {formatDate(selectedRequest.gameDate)} at {formatTime(selectedRequest.gameTime)}
              {selectedRequest.leagueName ? ` • ${selectedRequest.leagueName}` : ''}.
            </p>

            {selectedRequest.position && (
              <p className="text-gray-700 dark:text-gray-300">
                Position: <strong>{selectedRequest.position}</strong>
              </p>
            )}

            <div>
              <label htmlFor="comment" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {selectedRequest.requestType === 'private' && selectedRequest.inviteStatus === 'declined'
                  ? `Message for ${selectedRequest.requesterName} (required)`
                  : `Optional message for ${selectedRequest.requesterName}`}
              </label>
              <textarea
                id="comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                rows={3}
                placeholder={
                  selectedRequest.requestType === 'private' && selectedRequest.inviteStatus === 'declined'
                    ? 'Since you previously declined this request, please explain what changed so the requester isn’t confused...'
                    : 'Add any notes or questions...'
                }
              />
            </div>

            <div className="flex space-x-3">
              <Button
                onClick={handleRespond}
                disabled={
                  submitting ||
                  (selectedRequest.requestType === 'private' &&
                    selectedRequest.inviteStatus === 'declined' &&
                    !comment.trim())
                }
                className="flex-1"
              >
                {submitting ? 'Confirming...' : 'Confirm'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setSelectedRequest(null);
                  setComment('');
                }}
                disabled={submitting}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!declineRequest}
        onClose={() => {
          setDeclineRequest(null);
          setDeclineComment('');
        }}
        title="Decline private spare request"
      >
        {declineRequest && (
          <div className="space-y-4">
            <p className="text-gray-700 dark:text-gray-300">
              You&apos;re declining a private spare request for <strong>{declineRequest.requestedForName}</strong> on{' '}
              {formatDate(declineRequest.gameDate)} at {formatTime(declineRequest.gameTime)}
              {declineRequest.leagueName ? ` • ${declineRequest.leagueName}` : ''}.
            </p>

            <div>
              <label htmlFor="declineComment" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Optional message to the requester
              </label>
              <textarea
                id="declineComment"
                value={declineComment}
                onChange={(e) => setDeclineComment(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                rows={3}
                placeholder="If you add a message, it will be emailed to the requester."
              />
            </div>

            <div className="flex space-x-3">
              <Button
                variant="danger"
                onClick={handleDecline}
                disabled={declining}
                className="flex-1"
              >
                {declining ? 'Declining...' : 'Decline'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setDeclineRequest(null);
                  setDeclineComment('');
                }}
                disabled={declining}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!cancelRequest}
        onClose={() => {
          setCancelRequest(null);
          setCancelComment('');
        }}
        title="Cancel sparing"
      >
        {cancelRequest && (
          <div className="space-y-4">
            <p className="text-gray-700 dark:text-gray-300">
              Are you sure you want to cancel sparing for <strong>{cancelRequest.requestedForName}</strong>? Please include a comment for the spare requester.
            </p>

            <div>
              <label htmlFor="cancelComment" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Comment <span className="text-red-500">*</span>
              </label>
              <textarea
                id="cancelComment"
                value={cancelComment}
                onChange={(e) => setCancelComment(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                rows={4}
                placeholder="Please explain why you need to cancel..."
                required
              />
            </div>

            <div className="flex space-x-3">
              <Button
                onClick={handleCancelSparing}
                disabled={canceling || !cancelComment.trim()}
                variant="danger"
                className="flex-1"
              >
                {canceling ? 'Canceling...' : 'Confirm cancellation'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setCancelRequest(null);
                  setCancelComment('');
                }}
                disabled={canceling}
                className="flex-1"
              >
                Never mind
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <NotificationModal
        isOpen={notification.isOpen}
        message={notification.message}
        variant={notification.variant}
        onClose={() => setNotification({ ...notification, isOpen: false })}
        autoCloseMs={notification.variant === 'success' ? 3000 : 0}
      />
    </Layout>
  );
}
