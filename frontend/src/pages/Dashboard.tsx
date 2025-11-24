import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import api from '../utils/api';
import Modal from '../components/Modal';
import Button from '../components/Button';

interface SpareRequest {
  id: number;
  requesterName: string;
  requestedForName: string;
  gameDate: string;
  gameTime: string;
  position?: string;
  message?: string;
  requestType: string;
  createdAt: string;
  filledByName?: string;
}

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
}

export default function Dashboard() {
  const [openRequests, setOpenRequests] = useState<SpareRequest[]>([]);
  const [mySparing, setMySparing] = useState<SpareRequest[]>([]);
  const [filledRequests, setFilledRequests] = useState<SpareRequest[]>([]);
  const [myRequests, setMyRequests] = useState<MySpareRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFilled, setShowFilled] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<SpareRequest | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cancelRequest, setCancelRequest] = useState<SpareRequest | null>(null);
  const [cancelComment, setCancelComment] = useState('');
  const [canceling, setCanceling] = useState(false);

  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    try {
      const [openRes, mySparingRes, filledRes, myRequestsRes] = await Promise.all([
        api.get('/spares'),
        api.get('/spares/my-sparing'),
        api.get('/spares/filled-upcoming'),
        api.get('/spares/my-requests'),
      ]);
      setOpenRequests(openRes.data);
      setMySparing(mySparingRes.data);
      setFilledRequests(filledRes.data);
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

    setSubmitting(true);
    try {
      await api.post(`/spares/${selectedRequest.id}/respond`, {
        comment: comment || undefined,
      });

      // Reload all data
      await loadAllData();
      setSelectedRequest(null);
      setComment('');
    } catch (error) {
      console.error('Failed to respond to spare request:', error);
      alert('Failed to respond. This request may have already been filled.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelSparing = async () => {
    if (!cancelRequest) return;

    if (!cancelComment.trim()) {
      alert('Please provide a comment explaining why you are canceling.');
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
    } catch (error) {
      console.error('Failed to cancel sparing:', error);
      alert('Failed to cancel sparing. Please try again.');
    } finally {
      setCanceling(false);
    }
  };

  const handleCancelRequest = async (id: number) => {
    if (!confirm('Are you sure you want to cancel this spare request?')) {
      return;
    }

    try {
      await api.post(`/spares/${id}/cancel`);
      // Reload all data
      await loadAllData();
    } catch (error) {
      console.error('Failed to cancel request:', error);
      alert('Failed to cancel request');
    }
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

  const renderRequestCard = (request: SpareRequest, showButton = true, showMessage = true, showCancelButton = false) => (
    <div key={request.id} className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <div className="flex items-center space-x-2 mb-2">
            <h3 className="text-lg font-semibold">
              Spare needed for {request.requestedForName}
            </h3>
            {showButton && (
              <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm font-medium">
                Open
              </span>
            )}
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
              <span className="font-medium">Requested by:</span> {request.requesterName}
            </p>
            {request.filledByName && (
              <p>
                <span className="font-medium">Filled by:</span> {request.filledByName}
              </p>
            )}
            {showMessage && request.message && (
              <p className="italic mt-2">"{request.message}"</p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 ml-4">
          {showButton && (
            <Button
              onClick={() => setSelectedRequest(request)}
            >
              Sign Up
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

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold" style={{ color: '#121033' }}>
            Dashboard
          </h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            to="/request-spare"
            className="border-2 border-primary-orange text-gray-800 p-6 rounded-lg hover:bg-primary-orange hover:text-white transition-colors text-center"
          >
            <div className="text-4xl mb-2">🙋</div>
            <div className="text-xl font-semibold">Request a spare</div>
            <div className="text-sm mt-1">Need someone to fill in for your game?</div>
          </Link>

          <Link
            to="/availability"
            className="border-2 border-primary-teal text-gray-800 p-6 rounded-lg hover:bg-primary-teal hover:text-white transition-colors text-center"
          >
            <div className="text-4xl mb-2">📅</div>
            <div className="text-xl font-semibold">Set your availability</div>
            <div className="text-sm mt-1">Let others know when you can spare</div>
          </Link>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading...</div>
        ) : (
          <div className="space-y-6">
            {/* My Upcoming Sparing */}
            {mySparing.length > 0 && (
              <div>
                <h2 className="text-xl font-semibold mb-4" style={{ color: '#121033' }}>
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
                <h2 className="text-xl font-semibold mb-4" style={{ color: '#121033' }}>
                  My spare requests
                </h2>
                <div className="space-y-4">
                  {myRequests.map((request) => (
                    <div key={request.id} className="bg-white rounded-lg shadow p-6">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-2">
                            <h3 className="text-lg font-semibold">
                              Spare for {request.requestedForName}
                            </h3>
                            {request.status === 'open' && (
                              <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm font-medium">
                                Open
                              </span>
                            )}
                            {request.status === 'filled' && (
                              <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-sm font-medium">
                                Filled
                              </span>
                            )}
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
                            {request.message && (
                              <p className="italic mt-2">"{request.message}"</p>
                            )}
                            {request.status === 'filled' && request.filledByName && (
                              <p className="text-green-700 font-medium mt-2">
                                ✓ Filled by {request.filledByName}
                              </p>
                            )}
                            {request.status === 'filled' && request.sparerComment && (
                              <div className="mt-3 p-3 bg-gray-50 rounded-md">
                                <p className="text-sm font-medium text-gray-700 mb-1">Message from {request.filledByName}:</p>
                                <p className="text-sm text-gray-600 italic">"{request.sparerComment}"</p>
                              </div>
                            )}
                          </div>
                        </div>
                        {request.status === 'open' && (
                          <div className="ml-4">
                            <Button
                              variant="danger"
                              onClick={() => handleCancelRequest(request.id)}
                            >
                              Cancel
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Outstanding Spare Requests */}
            <div>
              <h2 className="text-xl font-semibold mb-4" style={{ color: '#121033' }}>
                Outstanding spare requests
              </h2>
              {openRequests.length === 0 ? (
                <div className="text-center py-8 bg-white rounded-lg shadow">
                  <div className="text-4xl mb-2">🎯</div>
                  <p className="text-gray-600">
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
                <button
                  onClick={() => setShowFilled(!showFilled)}
                  className="flex items-center justify-between w-full text-left mb-4"
                >
                  <h2 className="text-xl font-semibold" style={{ color: '#121033' }}>
                    Filled spare requests
                  </h2>
                  <span className="text-gray-500 text-sm">
                    {showFilled ? '▼' : '▶'} {filledRequests.length}
                  </span>
                </button>
                {showFilled && (
                  <div className="space-y-4">
                    {filledRequests.map((request) => renderRequestCard(request, false, false))}
                  </div>
                )}
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
            <p className="text-gray-700">
              You're signing up to spare for <strong>{selectedRequest.requestedForName}</strong> on{' '}
              {formatDate(selectedRequest.gameDate)} at {formatTime(selectedRequest.gameTime)}.
            </p>

            {selectedRequest.position && (
              <p className="text-gray-700">
                Position: <strong>{selectedRequest.position}</strong>
              </p>
            )}

            <div>
              <label htmlFor="comment" className="block text-sm font-medium text-gray-700 mb-2">
                Optional message for {selectedRequest.requesterName}
              </label>
              <textarea
                id="comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                rows={3}
                placeholder="Add any notes or questions..."
              />
            </div>

            <div className="flex space-x-3">
              <Button
                onClick={handleRespond}
                disabled={submitting}
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
        isOpen={!!cancelRequest}
        onClose={() => {
          setCancelRequest(null);
          setCancelComment('');
        }}
        title="Cancel sparing"
      >
        {cancelRequest && (
          <div className="space-y-4">
            <p className="text-gray-700">
              Are you sure you want to cancel sparing for <strong>{cancelRequest.requestedForName}</strong>? Please include a comment for the spare requester.
            </p>

            <div>
              <label htmlFor="cancelComment" className="block text-sm font-medium text-gray-700 mb-2">
                Comment <span className="text-red-500">*</span>
              </label>
              <textarea
                id="cancelComment"
                value={cancelComment}
                onChange={(e) => setCancelComment(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
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
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
}
