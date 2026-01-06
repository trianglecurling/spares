import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import Button from '../components/Button';
import Footer from '../components/Footer';

export default function Login() {
  const [contact, setContact] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'contact' | 'code' | 'select'>('contact');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [multipleMembers, setMultipleMembers] = useState<any[]>([]);
  const [tempToken, setTempToken] = useState('');
  const { login } = useAuth();
  const location = useLocation();

  // Get the intended destination from location state
  const from = (location.state as any)?.from?.pathname || null;

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await api.post('/auth/request-code', { contact });
      if (response.data.multipleMembers) {
        setMultipleMembers([]);
      }
      setStep('code');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to send code');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await api.post('/auth/verify-code', { contact, code });

      if (response.data.requiresSelection) {
        setMultipleMembers(response.data.members);
        setTempToken(response.data.tempToken);
        setStep('select');
      } else {
        login(response.data.token, response.data.member, from || undefined);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Invalid code');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectMember = async (memberId: number) => {
    setError('');
    setLoading(true);

    try {
      const response = await api.post('/auth/select-member', {
        memberId,
        tempToken,
      });
      login(response.data.token, response.data.member, from || undefined);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <div className="flex-grow flex items-center justify-center px-4 text-gray-900 dark:text-gray-100">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center">
            <h1 className="text-4xl font-bold mb-2 text-[#121033] dark:text-gray-100">
              Triangle Curling
            </h1>
            <p className="text-gray-600 dark:text-gray-400">Spare Management System</p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8">
            {step === 'contact' && (
              <form onSubmit={handleRequestCode} className="space-y-4">
                <div>
                  <label htmlFor="contact" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Email address
                  </label>
                  <input
                    type="email"
                    id="contact"
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                    placeholder="your.email@example.com"
                    autoComplete="email"
                    required
                  />
                </div>

                {error && (
                  <div className="text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/20 p-3 rounded">
                    {error}
                  </div>
                )}

                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? 'Sending...' : 'Send Login Code'}
                </Button>
              </form>
            )}

            {step === 'code' && (
              <form onSubmit={handleVerifyCode} className="space-y-4">
                <div>
                  <label htmlFor="code" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Enter the 6-digit code
                  </label>
                  <input
                    type="text"
                    id="code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md text-center text-2xl tracking-widest focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                    placeholder="000000"
                    maxLength={6}
                    required
                    autoFocus
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                    Code sent to {contact}
                  </p>
                </div>

                {error && (
                  <div className="text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/20 p-3 rounded">
                    {error}
                  </div>
                )}

                <div className="space-y-2">
                  <Button type="submit" disabled={loading} className="w-full">
                    {loading ? 'Verifying...' : 'Verify Code'}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setStep('contact');
                      setCode('');
                      setError('');
                    }}
                    className="w-full"
                  >
                    Back
                  </Button>
                </div>
              </form>
            )}

            {step === 'select' && (
              <div className="space-y-4">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Multiple members share this contact. Select your name:
                </p>

                {error && (
                  <div className="text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/20 p-3 rounded mb-4">
                    {error}
                  </div>
                )}

                <div className="space-y-2">
                  {multipleMembers.map((member) => (
                    <button
                      key={member.id}
                      onClick={() => handleSelectMember(member.id)}
                      disabled={loading}
                      className="w-full px-4 py-3 text-left border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                    >
                      {member.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      
      <Footer simple />
    </div>
  );
}
