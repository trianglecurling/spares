import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { get, post } from '../api/client';
import Button from '../components/Button';
import Footer from '../components/Footer';
import { buildContactPageLink } from '../constants/contactRecipients';
import type { AuthenticatedMember } from '../../../backend/src/types.ts';

const MEMBERSHIP_CONTACT_HREF = buildContactPageLink('membership');

type MemberOption = {
  id: number;
  name: string;
};

type LocationState = {
  from?: { pathname: string };
};

const normalizeThemePreference = (
  value: string | null | undefined
): AuthenticatedMember['themePreference'] => {
  if (value === 'light' || value === 'dark' || value === 'system') {
    return value;
  }
  return 'system';
};

const normalizeMember = (value: AuthenticatedMember): AuthenticatedMember => ({
  ...value,
  themePreference: normalizeThemePreference(value.themePreference),
});

const isSelectionResponse = (
  value: unknown
): value is { requiresSelection: true; tempToken: string; members: MemberOption[] } =>
  typeof value === 'object' &&
  value !== null &&
  (value as { requiresSelection?: boolean }).requiresSelection === true;

function MembershipContactLink({ children }: { children: ReactNode }) {
  return (
    <Link to={MEMBERSHIP_CONTACT_HREF} className="font-medium text-primary-teal-link hover:underline">
      {children}
    </Link>
  );
}

function LoginErrorMessage({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <div
      id={id}
      className="text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/20 p-3 rounded"
      role="alert"
    >
      {children}
    </div>
  );
}

const isLoginSuccessResponse = (
  value: unknown
): value is { accessToken: string; refreshToken: string; member: AuthenticatedMember } =>
  typeof value === 'object' &&
  value !== null &&
  'accessToken' in value &&
  'refreshToken' in value &&
  'member' in value &&
  typeof (value as { accessToken?: unknown }).accessToken === 'string' &&
  typeof (value as { refreshToken?: unknown }).refreshToken === 'string';

export default function Login() {
  const [contact, setContact] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'contact' | 'code' | 'select'>('contact');
  const [error, setError] = useState<ReactNode>(null);
  const [loading, setLoading] = useState(false);
  const [multipleMembers, setMultipleMembers] = useState<MemberOption[]>([]);
  const [tempToken, setTempToken] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [tokenError, setTokenError] = useState<ReactNode>(null);
  const { login } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const contactErrorId = useId();
  const tokenFieldId = useId();
  const tokenErrorId = useId();

  // Get the intended destination from location state
  const rawRedirectParam = searchParams.get('redirect');
  const redirectParam = rawRedirectParam?.startsWith('/') ? rawRedirectParam : null;
  const from = redirectParam || (location.state as LocationState | null)?.from?.pathname || null;

  useEffect(() => {
    let isActive = true;

    get('/install/status')
      .then((response) => {
        if (!isActive) return;
        if (response.configured === false) {
          navigate('/install', { replace: true });
        }
      })
      .catch(() => {
        // If the backend isn't reachable yet, stay on login.
      });

    return () => {
      isActive = false;
    };
  }, [navigate]);

  const handleTokenLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setTokenError(null);
    setError(null);
    setLoading(true);

    try {
      const response = await post('/auth/token', { token: accessToken.trim() });
      if (!isLoginSuccessResponse(response)) {
        setTokenError('Invalid token');
        return;
      }
      const member = normalizeMember({
        ...response.member,
        themePreference: normalizeThemePreference(response.member.themePreference),
      } as AuthenticatedMember);
      await login(response.accessToken, response.refreshToken, member, from || undefined);
    } catch (err: unknown) {
      const message = axios.isAxiosError(err) ? err.response?.data?.error : undefined;
      setTokenError(typeof message === 'string' && message ? message : 'Invalid token');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setTokenError(null);
    setLoading(true);

    try {
      const response = await post('/auth/request-code', { contact });
      if (isLoginSuccessResponse(response)) {
        const member = normalizeMember({
          ...response.member,
          themePreference: normalizeThemePreference(response.member.themePreference),
        } as AuthenticatedMember);
        await login(response.accessToken, response.refreshToken, member, from || undefined);
      } else if (isSelectionResponse(response)) {
        setMultipleMembers(response.members);
        setTempToken(response.tempToken);
        setStep('select');
      } else {
        const codeResponse = response as { success: boolean; multipleMembers: boolean };
        if (codeResponse.multipleMembers) {
          setMultipleMembers([]);
        }
        setStep('code');
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        setError(
          <>
            That email address was not found. If you are a member, please{' '}
            <MembershipContactLink>contact Membership</MembershipContactLink>.
          </>
        );
      } else {
        const message = axios.isAxiosError(err) ? err.response?.data?.error : undefined;
        setError(typeof message === 'string' && message ? message : 'Failed to send code');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setTokenError(null);
    setLoading(true);

    try {
      const response = await post('/auth/verify-code', { contact, code });

      if (isSelectionResponse(response)) {
        setMultipleMembers(response.members);
        setTempToken(response.tempToken);
        setStep('select');
      } else {
        const member = normalizeMember({
          ...response.member,
          themePreference: normalizeThemePreference(response.member.themePreference),
        } as AuthenticatedMember);
        await login(response.accessToken, response.refreshToken, member, from || undefined);
      }
    } catch (err: unknown) {
      const message = axios.isAxiosError(err) ? err.response?.data?.error : undefined;
      setError(message || 'Invalid code');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectMember = async (memberId: number) => {
    setError(null);
    setTokenError(null);
    setLoading(true);

    try {
      const response = await post('/auth/select-member', {
        memberId,
        tempToken,
      });
      if (isSelectionResponse(response)) {
        setMultipleMembers(response.members);
        setTempToken(response.tempToken);
        setStep('select');
      } else {
        const member = normalizeMember({
          ...response.member,
          themePreference: normalizeThemePreference(response.member.themePreference),
        } as AuthenticatedMember);
        await login(response.accessToken, response.refreshToken, member, from || undefined);
      }
    } catch (err: unknown) {
      const message = axios.isAxiosError(err) ? err.response?.data?.error : undefined;
      setError(message || 'Failed to login');
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
            <p className="text-gray-600 dark:text-gray-400">Member Login</p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8">
            {step === 'contact' && (
              <form onSubmit={handleRequestCode} className="space-y-4">
                <div>
                  <label
                    htmlFor="contact"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
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
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? contactErrorId : undefined}
                  />
                </div>

                {error ? <LoginErrorMessage id={contactErrorId}>{error}</LoginErrorMessage> : null}

                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? 'Sending...' : 'Send login code'}
                </Button>
              </form>
            )}

            {step === 'code' && (
              <form onSubmit={handleVerifyCode} className="space-y-4">
                <div>
                  <label
                    htmlFor="code"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
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

                {error ? <LoginErrorMessage>{error}</LoginErrorMessage> : null}

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
                      setError(null);
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

                {error ? <div className="mb-4"><LoginErrorMessage>{error}</LoginErrorMessage></div> : null}

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

            <details className="mt-6 border-t border-gray-200 pt-4 dark:border-gray-700">
              <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300">
                Sign in with access token
              </summary>
              <form onSubmit={handleTokenLogin} className="mt-4 space-y-4">
                <div>
                  <label
                    htmlFor={tokenFieldId}
                    className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    Access token
                  </label>
                  <input
                    id={tokenFieldId}
                    type="password"
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-primary-teal dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    autoComplete="off"
                    spellCheck={false}
                    required
                    aria-invalid={tokenError ? true : undefined}
                    aria-describedby={tokenError ? tokenErrorId : undefined}
                  />
                </div>
                {tokenError ? <LoginErrorMessage id={tokenErrorId}>{tokenError}</LoginErrorMessage> : null}
                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? 'Signing in...' : 'Sign in'}
                </Button>
              </form>
            </details>
          </div>

          <div className="space-y-4 text-center">
            <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
              User login is for Triangle Curling members. A login is not needed to register for public events. If you
              are a member and are having trouble logging in, please contact the{' '}
              <Link to={MEMBERSHIP_CONTACT_HREF} className="text-primary-teal-link hover:underline">
                Membership Committee
              </Link>
              .
            </p>
            <Link to="/" className="inline-block text-sm font-medium text-primary-teal-link hover:underline">
              Back to home
            </Link>
          </div>
        </div>
      </div>

      <Footer simple />
    </div>
  );
}
