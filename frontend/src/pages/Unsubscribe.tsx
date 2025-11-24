import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../utils/api';
import Button from '../components/Button';

export default function Unsubscribe() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleUnsubscribe = async () => {
    setLoading(true);
    setError('');

    try {
      if (token) {
        await api.post('/members/me/unsubscribe', {}, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } else {
        await api.post('/members/me/unsubscribe');
      }

      setConfirmed(true);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to unsubscribe. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (confirmed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full text-center">
          <div className="bg-white rounded-lg shadow-md p-8">
            <div className="text-6xl mb-4">✓</div>
            <h1 className="text-2xl font-bold mb-4" style={{ color: '#121033' }}>
              You've been unsubscribed
            </h1>
            <p className="text-gray-600 mb-4">
              You will no longer receive email notifications from Triangle Curling Spares.
            </p>
            <p className="text-sm text-gray-500">
              You have also been removed from all spare lists. If you'd like to receive
              notifications again in the future, you can log back in and update your settings.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-lg shadow-md p-8">
          <h1 className="text-2xl font-bold mb-4" style={{ color: '#121033' }}>
            Unsubscribe from Triangle Curling Spares
          </h1>

          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg
                  className="h-5 w-5 text-yellow-400"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm text-yellow-700">
                  <strong>Warning:</strong> If you unsubscribe, you will:
                </p>
                <ul className="mt-2 text-sm text-yellow-700 list-disc list-inside">
                  <li>Stop receiving all email notifications</li>
                  <li>Be removed from all spare lists</li>
                  <li>No longer be notified of spare requests</li>
                </ul>
              </div>
            </div>
          </div>

          <p className="text-gray-600 mb-6">
            Are you sure you want to unsubscribe from all Triangle Curling Spares emails?
          </p>

          {error && (
            <div className="text-red-600 text-sm bg-red-50 p-3 rounded mb-4">
              {error}
            </div>
          )}

          <div className="space-y-3">
            <Button
              variant="danger"
              onClick={handleUnsubscribe}
              disabled={loading}
              className="w-full"
            >
              {loading ? 'Unsubscribing...' : 'Yes, Unsubscribe Me'}
            </Button>

            <a
              href="/"
              className="block text-center px-4 py-2 text-gray-700 hover:text-gray-900"
            >
              Never mind, take me back
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

