import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function RespondToSpare() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading) {
      const token = searchParams.get('token');
      const requestId = searchParams.get('requestId');
      if (token) {
        // Token will be handled by AuthContext
        // Redirect to dashboard with requestId to open the response dialog
        setTimeout(() => {
          if (requestId) {
            navigate(`/?requestId=${requestId}`);
          } else {
            navigate('/');
          }
        }, 500);
      }
    }
  }, [isLoading, searchParams, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full text-center">
        <div className="text-6xl mb-4">🥌</div>
        <h1 className="text-2xl font-bold mb-2" style={{ color: '#121033' }}>
          Loading...
        </h1>
        <p className="text-gray-600">
          Please wait while we redirect you to respond to the spare request.
        </p>
      </div>
    </div>
  );
}

