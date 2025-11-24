import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import api from '../utils/api';
import Button from '../components/Button';
import Modal from '../components/Modal';

interface MySpareRequest {
  id: number;
  requestedForName: string;
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
  createdAt: string;
}

interface NotificationStatus {
  notificationStatus: string | null;
  totalMembers: number;
  notifiedMembers: number;
  nextNotificationAt: string | null;
  notificationPaused: boolean;
}

export default function MyRequests() {
  const [requests, setRequests] = useState<MySpareRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [reissueRequest, setReissueRequest] = useState<MySpareRequest | null>(null);
  const [reissueMessage, setReissueMessage] = useState('');
  const [reissuing, setReissuing] = useState(false);
  const [notificationStatuses, setNotificationStatuses] = useState<Record<number, NotificationStatus>>({});
  const [pausing, setPausing] = useState<number | null>(null);

  useEffect(() => {
    loadRequests();
  }, []);

  // Poll for notification status updates for open requests
  useEffect(() => {
    const loadNotificationStatuses = async () => {
      const openRequests = requests.filter(
        (r) => r.status === 'open'
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

  const handleCancel = async (id: number) => {
    if (!confirm('Are you sure you want to cancel this spare request?')) {
      return;
    }

    try {
      await api.post(`/spares/${id}/cancel`);
      setRequests(requests.map((r) => (r.id === id ? { ...r, status: 'cancelled' } : r)));
    } catch (error) {
      console.error('Failed to cancel request:', error);
      alert('Failed to cancel request');
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
        alert(
          `Re-issued spare request. ${response.data.notificationsQueued} notification(s) queued. Notifications will be sent gradually.`
        );
      } else {
        alert(
          `Re-issued spare request. ${response.data.notificationsSent || 0} notification(s) sent.`
        );
      }
      
      await loadRequests();
      setReissueRequest(null);
      setReissueMessage('');
    } catch (error) {
      console.error('Failed to re-issue request:', error);
      alert('Failed to re-issue request');
    } finally {
      setReissuing(false);
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
      alert('Failed to pause notifications');
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
      alert('Failed to unpause notifications');
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
      open: 'bg-blue-100 text-blue-800',
      filled: 'bg-green-100 text-green-800',
      cancelled: 'bg-gray-100 text-gray-800',
    };

    return (
      <span className={`px-2 py-1 rounded text-sm font-medium ${colors[status as keyof typeof colors]}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold" style={{ color: '#121033' }}>
            My spare requests
          </h1>
          <Link to="/request-spare">
            <Button>New request</Button>
          </Link>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading...</div>
        ) : requests.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <div className="text-6xl mb-4">📋</div>
            <p className="text-gray-600 text-lg mb-4">
              You have no current spare requests.
            </p>
            <Link to="/request-spare">
              <Button>Create your first request</Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {requests.map((request) => (
              <div key={request.id} className="bg-white rounded-lg shadow p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <div className="flex items-center space-x-2 mb-2">
                      <h3 className="text-lg font-semibold">
                        Spare for {request.requestedForName}
                      </h3>
                      {getStatusBadge(request.status)}
                      {request.position && (
                        <span className="bg-primary-teal text-white px-2 py-1 rounded text-sm">
                          {request.position}
                        </span>
                      )}
                    </div>

                    <div className="text-gray-600 space-y-1">
                      <p>
                        <span className="font-medium">When:</span> {formatDate(request.gameDate)}{' '}
                        at {formatTime(request.gameTime)}
                      </p>
                      <p>
                        <span className="font-medium">Type:</span>{' '}
                        {request.requestType === 'public' ? 'Public' : 'Private'}
                      </p>
                      {request.message && (
                        <p className="italic mt-2">"{request.message}"</p>
                      )}
                      {request.status === 'open' && notificationStatuses[request.id] && (
                        <div className="mt-3 p-3 bg-blue-50 rounded-md border border-blue-200">
                          {notificationStatuses[request.id].notificationStatus === 'in_progress' ? (
                            <>
                              <p className="text-sm text-blue-800">
                                <span className="font-medium">Notifications in progress...</span>{' '}
                                {notificationStatuses[request.id].notifiedMembers} of {notificationStatuses[request.id].totalMembers} members notified.
                                {notificationStatuses[request.id].notificationPaused && (
                                  <span className="ml-2 font-semibold text-orange-600">(Paused)</span>
                                )}
                              </p>
                            </>
                          ) : notificationStatuses[request.id].notificationStatus === 'completed' ? (
                            <p className="text-sm text-green-800">
                              <span className="font-medium">All notifications sent.</span>{' '}
                              {notificationStatuses[request.id].totalMembers} members notified.
                            </p>
                          ) : notificationStatuses[request.id].notificationStatus === 'stopped' ? (
                            <p className="text-sm text-gray-600">
                              Notifications stopped (request filled or cancelled).
                            </p>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2 ml-4">
                    {request.status === 'open' && (
                      <>
                        {notificationStatuses[request.id]?.notificationStatus === 'in_progress' && (
                          notificationStatuses[request.id].notificationPaused ? (
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
                          )
                        )}
                        {shouldShowReissueButton(request) && (
                          <Button
                            variant="secondary"
                            onClick={() => handleReissueClick(request)}
                          >
                            Re-issue
                          </Button>
                        )}
                        <Button
                          variant="danger"
                          onClick={() => handleCancel(request.id)}
                        >
                          Cancel
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {request.status === 'filled' && request.filledByName && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <p className="text-green-700 font-medium">
                      ✓ Filled by {request.filledByName}
                    </p>
                    {request.filledAt && (
                      <p className="text-sm text-gray-500 mt-1">
                        on {new Date(request.filledAt).toLocaleDateString()} at{' '}
                        {new Date(request.filledAt).toLocaleTimeString()}
                      </p>
                    )}
                    {request.sparerComment && (
                      <div className="mt-3 p-3 bg-gray-50 rounded-md">
                        <p className="text-sm font-medium text-gray-700 mb-1">Message from {request.filledByName}:</p>
                        <p className="text-sm text-gray-600 italic">"{request.sparerComment}"</p>
                      </div>
                    )}
                  </div>
                )}

                {request.status === 'cancelled' && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <p className="text-gray-600">This request was cancelled</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
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
            <p className="text-gray-700">
              You're about to re-send notifications for your spare request for <strong>{reissueRequest.requestedForName}</strong> on{' '}
              {formatDate(reissueRequest.gameDate)} at {formatTime(reissueRequest.gameTime)}.
            </p>

            <div>
              <label htmlFor="reissueMessage" className="block text-sm font-medium text-gray-700 mb-2">
                Message (optional)
              </label>
              <textarea
                id="reissueMessage"
                value={reissueMessage}
                onChange={(e) => setReissueMessage(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                rows={4}
                placeholder="Add or update your message for potential spares..."
              />
              <p className="text-sm text-gray-500 mt-1">
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
    </Layout>
  );
}

