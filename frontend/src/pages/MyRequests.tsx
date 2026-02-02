import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HiChevronDown, HiOutlineClipboardDocument, HiPlus } from 'react-icons/hi2';
import Layout from '../components/Layout';
import api, { formatApiError } from '../utils/api';
import Button from '../components/Button';
import Modal from '../components/Modal';
import NotificationModal from '../components/NotificationModal';
import { useAlert } from '../contexts/AlertContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { useAuth } from '../contexts/AuthContext';
import { renderMe } from '../utils/me';

interface MySpareRequest {
  id: number;
  requestedForName: string;
  requestedForMemberId?: number | null;
  requesterId?: number | null;
  requesterName?: string | null;
  cancelledByName?: string | null;
  gameDate: string;
  gameTime: string;
  position?: string;
  message?: string;
  requestType: string;
  status: string;
  filledByName?: string;
  filledAt?: string;
  sparerComment?: string;
  notificationsSentAt?: string;
  hadCancellation?: boolean;
  invites?: { name: string; status: 'pending' | 'declined' }[];
  inviteCounts?: { total: number; pending: number; declined: number };
  createdAt: string;
}

interface DirectoryMember {
  id: number;
  name: string;
}

interface InvitationStatusRow {
  memberId: number;
  name: string;
  status: 'pending' | 'declined';
  declinedAt: string | null;
  declineComment: string | null;
  invitedAt: string;
}

interface NotificationStatus {
  notificationStatus: string | null;
  totalMembers: number;
  notifiedMembers: number;
  nextNotificationAt: string | null;
  notificationPaused: boolean;
}

export default function MyRequests() {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const { member } = useAuth();
  const [requests, setRequests] = useState<MySpareRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [pastExpanded, setPastExpanded] = useState(false);
  const [pastLoading, setPastLoading] = useState(false);
  const [pastLoaded, setPastLoaded] = useState(false);
  const [pastError, setPastError] = useState<string | null>(null);
  const [pastRequests, setPastRequests] = useState<MySpareRequest[]>([]);
  const [reissueRequest, setReissueRequest] = useState<MySpareRequest | null>(null);
  const [reissueMessage, setReissueMessage] = useState('');
  const [reissuing, setReissuing] = useState(false);
  const [inviteRequest, setInviteRequest] = useState<MySpareRequest | null>(null);
  const [invitees, setInvitees] = useState<DirectoryMember[]>([]);
  const [inviteFilter, setInviteFilter] = useState('');
  const [selectedInviteIds, setSelectedInviteIds] = useState<Set<number>>(new Set());
  const [inviting, setInviting] = useState(false);
  const [invitationStatuses, setInvitationStatuses] = useState<InvitationStatusRow[]>([]);
  const [loadingInvitations, setLoadingInvitations] = useState(false);
  const [notificationStatuses, setNotificationStatuses] = useState<Record<number, NotificationStatus>>({});
  const [pausing, setPausing] = useState<number | null>(null);
  const [notification, setNotification] = useState<{
    isOpen: boolean;
    message: string;
    variant: 'success' | 'error';
  }>({ isOpen: false, message: '', variant: 'success' });

  useEffect(() => {
    loadRequests();
  }, []);

  // Poll for notification status updates for open requests
  useEffect(() => {
    const loadNotificationStatuses = async () => {
      const openRequests = requests.filter(
        (r) => r.status === 'open' && r.requesterId === member?.id
      );

      if (openRequests.length === 0) {
        return;
      }

      try {
        const statusPromises = openRequests.map((req) =>
          api.get(`/spares/${req.id}/notification-status`).then((res) => ({
            id: req.id,
            status: res.data,
          }))
        );

        const results = await Promise.all(statusPromises);
        const statusMap: Record<number, NotificationStatus> = {};
        results.forEach(({ id, status }) => {
          statusMap[id] = status;
        });
        setNotificationStatuses(statusMap);
      } catch (error) {
        console.error('Failed to load notification statuses:', error);
      }
    };

    loadNotificationStatuses();

    // Poll every 30 seconds for updates
    const interval = setInterval(loadNotificationStatuses, 30000);
    return () => clearInterval(interval);
  }, [requests]);

  const loadRequests = async () => {
    try {
      const response = await api.get('/spares/my-requests');
      setRequests(response.data);
    } catch (error) {
      console.error('Failed to load requests:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadPastRequests = async () => {
    setPastError(null);
    setPastLoading(true);
    try {
      const response = await api.get('/spares/my-requests/past');
      setPastRequests(response.data);
      setPastLoaded(true);
    } catch (error) {
      console.error('Failed to load past requests:', error);
      setPastError(formatApiError(error, 'Failed to load past requests'));
    } finally {
      setPastLoading(false);
    }
  };

  const handleCancel = async (id: number) => {
    const confirmed = await confirm({
      title: 'Cancel spare request',
      message: 'Are you sure you want to cancel this spare request?',
      variant: 'danger',
      confirmText: 'Yes, cancel request',
      cancelText: 'Never mind',
    });

    if (!confirmed) {
      return;
    }

    // Find the request to get details for the success message
    const request = requests.find((r) => r.id === id);
    const isRequester = request?.requesterId === member?.id;

    try {
      await api.post(`/spares/${id}/cancel`);
      setRequests(requests.map((r) => (
        r.id === id
          ? { ...r, status: 'cancelled', cancelledByName: member?.name || r.cancelledByName }
          : r
      )));
      
      // Show success notification
      if (request) {
        setNotification({
          isOpen: true,
          message: isRequester
            ? `Your spare request for ${request.requestedForName} has been successfully canceled.`
            : `The spare request for ${request.requestedForName} has been successfully canceled.`,
          variant: 'success',
        });
      }
    } catch (error) {
      console.error('Failed to cancel request:', error);
      showAlert(formatApiError(error, 'Failed to cancel request'), 'error');
    }
  };

  const handleReissueClick = (request: MySpareRequest) => {
    setReissueRequest(request);
    setReissueMessage(request.message || '');
  };

  const handleReissue = async () => {
    if (!reissueRequest) return;

    setReissuing(true);
    try {
      const response = await api.post(`/spares/${reissueRequest.id}/reissue`, {
        message: reissueMessage || undefined,
      });
      
      if (response.data.notificationsQueued !== undefined) {
        showAlert(
          `Re-issued spare request. ${response.data.notificationsQueued} notification(s) queued. Notifications will be sent gradually.`,
          'success'
        );
      } else {
        showAlert(
          `Re-issued spare request. ${response.data.notificationsSent || 0} notification(s) sent.`,
          'success'
        );
      }
      
      await loadRequests();
      setReissueRequest(null);
      setReissueMessage('');
    } catch (error) {
      console.error('Failed to re-issue request:', error);
      showAlert(formatApiError(error, 'Failed to re-issue request'), 'error');
    } finally {
      setReissuing(false);
    }
  };

  const openInviteModal = async (request: MySpareRequest) => {
    setInviteRequest(request);
    setInviteFilter('');
    setSelectedInviteIds(new Set());
    setLoadingInvitations(true);
    try {
      const [dirRes, invitesRes] = await Promise.all([
        api.get('/members/directory'),
        api.get(`/spares/${request.id}/invitations`),
      ]);
      const directoryMembers = (dirRes.data as Array<{ id: number; name: string }> | undefined) || [];
      setInvitees(directoryMembers.map((m) => ({ id: m.id, name: m.name })));
      setInvitationStatuses(invitesRes.data || []);
    } catch (e) {
      console.error('Failed to load invite modal data:', e);
      setInvitees([]);
      setInvitationStatuses([]);
      showAlert(formatApiError(e, 'Failed to load invitation data'), 'error');
    } finally {
      setLoadingInvitations(false);
    }
  };

  const handleInviteMore = async () => {
    if (!inviteRequest) return;
    const ids = Array.from(selectedInviteIds);
    if (ids.length === 0) {
      showAlert('Select at least one member to invite', 'warning');
      return;
    }
    setInviting(true);
    try {
      await api.post(`/spares/${inviteRequest.id}/invite`, { memberIds: ids });
      showAlert(`Invited ${ids.length} member(s).`, 'success');
      await loadRequests();
      setInviteRequest(null);
      setSelectedInviteIds(new Set());
      setInvitationStatuses([]);
    } catch (e: unknown) {
      console.error('Failed to invite more members:', e);
      showAlert(formatApiError(e, 'Failed to invite members'), 'error');
    } finally {
      setInviting(false);
    }
  };

  const handleMakePublic = async (request: MySpareRequest) => {
    const confirmed = await confirm({
      title: 'Convert to public request?',
      message:
        'This will convert your private spare request to a public request and start notifying available members. This action cannot be undone.',
      variant: 'danger',
      confirmText: 'Convert to public',
      cancelText: 'Keep private',
    });
    if (!confirmed) return;

    try {
      const res = await api.post(`/spares/${request.id}/make-public`);
      if (res.data?.notificationsQueued !== undefined) {
        showAlert(`Converted to public. ${res.data.notificationsQueued} notification(s) queued.`, 'success');
      } else if (res.data?.notificationsSent !== undefined) {
        showAlert(`Converted to public. ${res.data.notificationsSent} notification(s) sent.`, 'success');
      } else {
        showAlert('Converted to public.', 'success');
      }
      await loadRequests();
    } catch (e: unknown) {
      console.error('Failed to make public:', e);
      showAlert(formatApiError(e, 'Failed to convert to public'), 'error');
    }
  };

  const handlePauseNotifications = async (id: number) => {
    setPausing(id);
    try {
      await api.post(`/spares/${id}/pause-notifications`);
      await loadRequests();
      // Reload notification statuses
      const statusResponse = await api.get(`/spares/${id}/notification-status`);
      setNotificationStatuses(prev => ({
        ...prev,
        [id]: statusResponse.data,
      }));
    } catch (error) {
      console.error('Failed to pause notifications:', error);
      showAlert(formatApiError(error, 'Failed to pause notifications'), 'error');
    } finally {
      setPausing(null);
    }
  };

  const handleUnpauseNotifications = async (id: number) => {
    setPausing(id);
    try {
      await api.post(`/spares/${id}/unpause-notifications`);
      await loadRequests();
      // Reload notification statuses
      const statusResponse = await api.get(`/spares/${id}/notification-status`);
      setNotificationStatuses(prev => ({
        ...prev,
        [id]: statusResponse.data,
      }));
    } catch (error) {
      console.error('Failed to unpause notifications:', error);
      showAlert(formatApiError(error, 'Failed to unpause notifications'), 'error');
    } finally {
      setPausing(null);
    }
  };

  const shouldShowReissueButton = (request: MySpareRequest): boolean => {
    if (request.status !== 'open') {
      return false;
    }

    // Condition 1: Someone signed up then later canceled - show button immediately
    if (request.hadCancellation) {
      return true;
    }

    // Condition 2: It has been more than 72 hours since the last time notifications were sent
    if (request.notificationsSentAt) {
      const lastSent = new Date(request.notificationsSentAt);
      const now = new Date();
      const hoursSinceLastSent = (now.getTime() - lastSent.getTime()) / (1000 * 60 * 60);
      
      if (hoursSinceLastSent >= 72) {
        return true;
      }
    }

    return false;
  };

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

  const getStatusBadge = (status: string) => {
    const colors = {
      open: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200',
      filled: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200',
      cancelled: 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300',
    };

    return (
      <span className={`px-2 py-1 rounded text-sm font-medium ${colors[status as keyof typeof colors]}`}>
        {status === 'open' ? 'Unfilled' : status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold text-[#121033] dark:text-gray-100">
            My spare requests
          </h1>
          <Link to="/request-spare">
            <Button>
              <HiPlus className="w-5 h-5 mr-1" />
              New request
            </Button>
          </Link>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading...</div>
        ) : requests.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow">
            <div className="flex justify-center mb-4">
              <HiOutlineClipboardDocument className="w-16 h-16 text-gray-400 dark:text-gray-500" />
            </div>
            <p className="text-gray-600 dark:text-gray-400 text-lg mb-4">
              You have no current spare requests.
            </p>
            <Link to="/request-spare">
              <Button>
                <HiPlus className="w-5 h-5 mr-1" />
                New spare request
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {requests.map((request) => (
              <div key={request.id} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <div className="flex items-center space-x-2 mb-2">
                      <h3 className="text-lg font-semibold dark:text-gray-100">
                        Spare for {renderMe(request.requestedForName, member?.name)}
                      </h3>
                      {getStatusBadge(request.status)}
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
                      </p>
                      {request.requesterId && request.requesterId !== member?.id && request.requesterName && (
                        <p>
                          <span className="font-medium dark:text-gray-300">Requested by:</span>{' '}
                          {renderMe(request.requesterName, member?.name)}
                        </p>
                      )}
                      <p>
                        <span className="font-medium dark:text-gray-300">Type:</span>{' '}
                        {request.requestType === 'public' ? 'Public' : 'Private'}
                      </p>
                      {request.status === 'open' && request.requestType === 'private' && request.inviteCounts && (
                        <div className="mt-1">
                          <p className="text-sm text-gray-700 dark:text-gray-300">
                            <span className="font-medium">Invites:</span>{' '}
                            {request.inviteCounts.pending} pending, {request.inviteCounts.declined} declined
                          </p>
                          {request.invites && request.invites.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {request.invites.map((i) => (
                                <span
                                  key={`${request.id}-${i.name}`}
                                  className={`px-2 py-1 rounded text-xs font-medium ${
                                    i.status === 'declined'
                                      ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
                                      : 'bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200'
                                  }`}
                                >
                                  {i.name} • {i.status}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {request.message && (
                        <p className="italic mt-2">"{request.message}"</p>
                      )}
                      {request.status === 'open' && request.requesterId === member?.id && notificationStatuses[request.id] && (
                        <div className={`mt-3 p-3 rounded-md border ${
                          (() => {
                            const status = notificationStatuses[request.id];
                            const allNotified = status.notifiedMembers === status.totalMembers;
                            if (status.notificationStatus === 'completed' || allNotified) {
                              return 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
                            }
                            if (status.notificationStatus === 'stopped') {
                              return 'bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-700';
                            }
                            return 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800';
                          })()
                        }`}>
                          {(() => {
                            const status = notificationStatuses[request.id];
                            const allNotified = status.notifiedMembers === status.totalMembers;
                            
                            // If all members are notified, show completed message even if status is 'in_progress'
                            if (status.notificationStatus === 'completed' || allNotified) {
                              return (
                                <p className="text-sm text-green-800 dark:text-green-300">
                                  <span className="font-medium">All notifications sent.</span>{' '}
                                  {status.totalMembers} members notified.
                                </p>
                              );
                            }
                            
                            if (status.notificationStatus === 'in_progress') {
                              return (
                                <p className="text-sm text-blue-800 dark:text-blue-300">
                                  <span className="font-medium">Notifications in progress...</span>{' '}
                                  {status.notifiedMembers} of {status.totalMembers} members notified.
                                  {status.notificationPaused && (
                                    <span className="ml-2 font-semibold text-orange-600 dark:text-orange-400">(Paused)</span>
                                  )}
                                </p>
                              );
                            }
                            
                            if (status.notificationStatus === 'stopped') {
                              return (
                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                  Notifications stopped (request filled or cancelled).
                                </p>
                              );
                            }
                            
                            return null;
                          })()}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2 ml-4">
                    {request.status === 'open' && (
                      <>
                        {(() => {
                          const status = notificationStatuses[request.id];
                          const allNotified = status && status.notifiedMembers === status.totalMembers;
                          const isInProgress = status?.notificationStatus === 'in_progress' && !allNotified;
                          const isRequester = request.requesterId === member?.id;
                          if (!isRequester) {
                            return null;
                          }
                          
                          if (isInProgress) {
                            return status.notificationPaused ? (
                              <Button
                                variant="secondary"
                                onClick={() => handleUnpauseNotifications(request.id)}
                                disabled={pausing === request.id}
                              >
                                {pausing === request.id ? 'Unpausing...' : 'Unpause notifications'}
                              </Button>
                            ) : (
                              <Button
                                variant="secondary"
                                onClick={() => handlePauseNotifications(request.id)}
                                disabled={pausing === request.id}
                              >
                                {pausing === request.id ? 'Pausing...' : 'Pause notifications'}
                              </Button>
                            );
                          }
                          return null;
                        })()}
                        {request.requesterId === member?.id && shouldShowReissueButton(request) && (
                          <Button
                            variant="secondary"
                            onClick={() => handleReissueClick(request)}
                          >
                            Re-issue
                          </Button>
                        )}
                        {request.requesterId === member?.id && request.requestType === 'private' && (
                          <>
                            <Button
                              variant="secondary"
                              onClick={() => openInviteModal(request)}
                            >
                              Invite more
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => handleMakePublic(request)}
                            >
                              Make public
                            </Button>
                          </>
                        )}
                        {(request.requesterId === member?.id || request.requestedForMemberId === member?.id) && (
                          <Button
                            variant="danger"
                            onClick={() => handleCancel(request.id)}
                          >
                            Cancel
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {request.status === 'filled' && request.filledByName && (
                  <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <p className="text-green-700 dark:text-green-400 font-medium">
                      ✓ Filled by {renderMe(request.filledByName, member?.name)}
                    </p>
                    {request.filledAt && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        on {new Date(request.filledAt).toLocaleDateString()} at{' '}
                        {new Date(request.filledAt).toLocaleTimeString()}
                      </p>
                    )}
                    {request.sparerComment && (
                      <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-md">
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Message from {renderMe(request.filledByName, member?.name)}:
                        </p>
                        <p className="text-sm text-gray-600 dark:text-gray-400 italic">"{request.sparerComment}"</p>
                      </div>
                    )}
                  </div>
                )}

                {request.status === 'cancelled' && (
                  <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <p className="text-gray-600 dark:text-gray-400">
                      This request was cancelled
                      {request.cancelledByName ? ` by ${renderMe(request.cancelledByName, member?.name)}` : ''}.
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <button
            type="button"
            className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            onClick={() => {
              const next = !pastExpanded;
              setPastExpanded(next);
              if (next && !pastLoaded && !pastLoading) {
                loadPastRequests();
              }
            }}
            aria-expanded={pastExpanded}
          >
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Past spare requests
              </h2>
            </div>
            <HiChevronDown
              className={`w-5 h-5 text-gray-500 dark:text-gray-400 transition-transform ${pastExpanded ? 'rotate-180' : ''}`}
            />
          </button>

          {pastExpanded && (
            <div className="border-t border-gray-200 dark:border-gray-700 px-5 py-4">
              {pastLoading ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">Loading past requests...</div>
              ) : pastError ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm text-red-600 dark:text-red-400">{pastError}</div>
                  <Button
                    variant="secondary"
                    onClick={() => loadPastRequests()}
                    className="shrink-0"
                  >
                    Retry
                  </Button>
                </div>
              ) : pastRequests.length === 0 ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  No past spare requests found.
                </div>
              ) : (
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                  {pastRequests.map((request) => (
                    <div key={request.id} className="py-3 flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {formatDate(request.gameDate)} • {formatTime(request.gameTime)}
                          </span>
                          {getStatusBadge(request.status)}
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
                        {request.requesterId && request.requesterId !== member?.id && request.requesterName && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            Requested by {renderMe(request.requesterName, member?.name)}
                          </div>
                        )}
                        {request.status === 'cancelled' && request.cancelledByName && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            Cancelled by {renderMe(request.cancelledByName, member?.name)}
                          </div>
                        )}
                        {request.status === 'filled' && request.filledByName && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            Filled by {renderMe(request.filledByName, member?.name)}
                          </div>
                        )}
                      </div>

                      <div className="text-xs text-gray-500 dark:text-gray-400 shrink-0 pt-0.5">
                        {request.requestType === 'public' ? 'Public' : 'Private'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Modal
        isOpen={!!reissueRequest}
        onClose={() => {
          setReissueRequest(null);
          setReissueMessage('');
        }}
        title="Re-issue spare request"
      >
        {reissueRequest && (
          <div className="space-y-4">
            <p className="text-gray-700 dark:text-gray-300">
              You're about to re-send notifications for your spare request for <strong>{reissueRequest.requestedForName}</strong> on{' '}
              {formatDate(reissueRequest.gameDate)} at {formatTime(reissueRequest.gameTime)}.
            </p>

            <div>
              <label htmlFor="reissueMessage" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Message (optional)
              </label>
              <textarea
                id="reissueMessage"
                value={reissueMessage}
                onChange={(e) => setReissueMessage(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                rows={4}
                placeholder="Add or update your message for potential spares..."
              />
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Leave blank to use the original message, or update it with new information.
              </p>
            </div>

            <div className="flex space-x-3">
              <Button
                onClick={handleReissue}
                disabled={reissuing}
                className="flex-1"
              >
                {reissuing ? 'Re-issuing...' : 'Confirm & Re-issue'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setReissueRequest(null);
                  setReissueMessage('');
                }}
                disabled={reissuing}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!inviteRequest}
        onClose={() => {
          setInviteRequest(null);
          setInviteFilter('');
          setSelectedInviteIds(new Set());
          setInvitationStatuses([]);
        }}
        title="Invite more people"
        size="lg"
      >
        {inviteRequest && (
          <div className="space-y-4">
            <p className="text-gray-700 dark:text-gray-300">
              Invite more members to your private spare request for <strong>{renderMe(inviteRequest.requestedForName, member?.name)}</strong>.
            </p>

            {loadingInvitations ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div>
            ) : (
              <>
                <div className="bg-gray-50 dark:bg-gray-700/40 border border-gray-200 dark:border-gray-600 rounded-md p-3">
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">
                    Current invites
                  </div>
                  {invitationStatuses.length === 0 ? (
                    <div className="text-sm text-gray-600 dark:text-gray-400">No invites found.</div>
                  ) : (
                    <ul className="text-sm text-gray-700 dark:text-gray-300 space-y-1">
                      {invitationStatuses.map((i) => (
                        <li key={i.memberId}>
                          {i.name}{' '}
                          {i.status === 'declined' ? (
                            <span className="text-gray-500 dark:text-gray-400">(declined)</span>
                          ) : (
                            <span className="text-gray-500 dark:text-gray-400">(pending)</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Add invitees
                  </label>
                  <input
                    type="text"
                    value={inviteFilter}
                    onChange={(e) => setInviteFilter(e.target.value)}
                    placeholder="Search members..."
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                  />
                </div>

                <div className="max-h-64 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-md">
                  {invitees
                    .filter((m) => m.name.toLowerCase().includes(inviteFilter.toLowerCase()))
                    .map((m) => {
                      const alreadyInvited = invitationStatuses.some((i) => i.memberId === m.id);
                      const checked = selectedInviteIds.has(m.id);
                      return (
                        <label
                          key={m.id}
                          className={`flex items-center gap-3 px-4 py-2 border-b border-gray-100 dark:border-gray-700 ${
                            alreadyInvited ? 'opacity-60' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            disabled={alreadyInvited}
                            checked={checked}
                            onChange={(e) => {
                              const next = new Set(selectedInviteIds);
                              if (e.target.checked) next.add(m.id);
                              else next.delete(m.id);
                              setSelectedInviteIds(next);
                            }}
                          />
                          <span className="text-sm text-gray-800 dark:text-gray-100">{m.name}</span>
                          {alreadyInvited && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">(already invited)</span>
                          )}
                        </label>
                      );
                    })}
                </div>

                <div className="flex space-x-3 pt-2">
                  <Button
                    onClick={handleInviteMore}
                    disabled={inviting || selectedInviteIds.size === 0}
                    className="flex-1"
                  >
                    {inviting ? 'Inviting...' : 'Send invites'}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setInviteRequest(null);
                      setInviteFilter('');
                      setSelectedInviteIds(new Set());
                      setInvitationStatuses([]);
                    }}
                    disabled={inviting}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                </div>
              </>
            )}
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

