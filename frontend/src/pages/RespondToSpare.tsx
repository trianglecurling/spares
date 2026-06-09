import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function RespondToSpare() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading) {
      const requestId = searchParams.get('requestId');
      setTimeout(() => {
        if (requestId) {
          navigate(`/dashboard?requestId=${requestId}`);
        } else {
          navigate('/dashboard');
        }
      }, 500);
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
