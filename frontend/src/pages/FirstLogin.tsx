import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { HiOutlineInformationCircle } from 'react-icons/hi2';
import { useAuth } from '../contexts/AuthContext';
import { get, patch, post } from '../api/client';
import Button from '../components/Button';
import Footer from '../components/Footer';

export default function FirstLogin() {
  const { member, updateMember, logout } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [name, setName] = useState(member?.name || '');
  const [email, setEmail] = useState(member?.email || '');
  const [phone, setPhone] = useState(member?.phone || '');
  const [optedInSms, setOptedInSms] = useState(false);
  const [emailVisible, setEmailVisible] = useState(true);
  const [phoneVisible, setPhoneVisible] = useState(true);
  const [loading, setLoading] = useState(false);
  const [smsDisabled, setSmsDisabled] = useState<boolean | null>(null);

  const normalizeThemePreference = (value?: string | null): 'light' | 'dark' | 'system' => {
    if (value === 'light' || value === 'dark' || value === 'system') return value;
    return 'system';
  };

  // If someone manually hits /first-login after they've already completed it, send them home.
  // Important: do NOT auto-redirect on completion, because handleComplete decides where to go.
  useEffect(() => {
    if (member?.firstLoginCompleted && step === 1) {
      navigate('/', { replace: true });
    }
  }, [member, navigate, step]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await get('/public-config');
        setSmsDisabled(!!res?.disableSms);
        if (res?.disableSms) {
          setOptedInSms(false);
        }
      } catch {
        // If we can't load config, default to showing the checkbox (existing behavior).
        setSmsDisabled(false);
      }
    };
    load();
  }, []);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await patch('/members/me', {
        name,
        email,
        phone: phone || undefined,
        optedInSms: smsDisabled ? false : optedInSms,
        emailVisible,
        phoneVisible,
      });

      updateMember({ ...response, themePreference: normalizeThemePreference(response.themePreference) });
      setStep(2);
    } catch (error) {
      console.error('Failed to update profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async () => {
    setLoading(true);

    try {
      await post('/members/me/complete-first-login', undefined);
      updateMember({ ...member!, firstLoginCompleted: true });

      // 1) If the user came from a spare accept link, go back to the dashboard with requestId
      // so the accept popup opens.
      const pendingRequestId = sessionStorage.getItem('pendingSpareAcceptRequestId');
      if (pendingRequestId) {
        sessionStorage.removeItem('pendingSpareAcceptRequestId');
        navigate(`/?requestId=${pendingRequestId}`, { replace: true });
        return;
      }

      // 1b) If the user came from a decline link, go back to dashboard with declineRequestId
      // so the decline modal opens.
      const pendingDeclineId = sessionStorage.getItem('pendingSpareDeclineRequestId');
      if (pendingDeclineId) {
        sessionStorage.removeItem('pendingSpareDeclineRequestId');
        navigate(`/?declineRequestId=${pendingDeclineId}`, { replace: true });
        return;
      }

      // 2) Otherwise, if there was a stored redirect target (non-first-login), go there.
      const redirect = sessionStorage.getItem('postFirstLoginRedirect');
      const redirectPath = redirect ? redirect.split('?')[0] : null;
      if (redirect && redirectPath && redirectPath !== '/first-login' && redirectPath !== '/') {
        sessionStorage.removeItem('postFirstLoginRedirect');
        navigate(redirect, { replace: true });
        return;
      }

      // 3) Default: new user should set availability
      navigate('/availability');
    } catch (error) {
      console.error('Failed to complete first login:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <div className="flex-grow flex items-center justify-center px-4">
        <div className="max-w-2xl w-full">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 relative">
            <button
              type="button"
              onClick={logout}
              className="absolute top-4 right-4 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
            >
              Logout
            </button>
            <h1 className="text-3xl font-bold mb-2 text-[#121033] dark:text-gray-100">
              Welcome to Triangle Curling Spares!
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mb-8">
              Let's get your profile set up.
            </p>

            {step === 1 && (
              <form onSubmit={handleUpdateProfile} className="space-y-6">
                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Your name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                    placeholder="The name most people know you by"
                    required
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Use the name that most people in the club know you by
                  </p>
                </div>

                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Email address <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    id="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                    placeholder="your.email@example.com"
                    required
                  />
                  
                  <div className="mt-2 flex items-start">
                    <input
                      type="checkbox"
                      id="emailVisible"
                      checked={emailVisible}
                      onChange={(e) => setEmailVisible(e.target.checked)}
                      className="mt-1 mr-3 rounded border-gray-300 dark:border-gray-600 text-primary-teal focus:ring-primary-teal"
                    />
                    <label htmlFor="emailVisible" className="text-sm text-gray-600 dark:text-gray-400">
                      Make my email address visible to other club members in the directory
                    </label>
                  </div>
                </div>

                <div>
                  <label htmlFor="phone" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Phone number
                  </label>
                  <input
                    type="tel"
                    id="phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                    placeholder="(555) 123-4567"
                  />

                  <div className="mt-2 flex items-start">
                    <input
                      type="checkbox"
                      id="phoneVisible"
                      checked={phoneVisible}
                      onChange={(e) => setPhoneVisible(e.target.checked)}
                      className="mt-1 mr-3 rounded border-gray-300 dark:border-gray-600 text-primary-teal focus:ring-primary-teal"
                    />
                    <label htmlFor="phoneVisible" className="text-sm text-gray-600 dark:text-gray-400">
                      Make my phone number visible to other club members in the directory
                    </label>
                  </div>
                </div>

                <div className="bg-gray-50 dark:bg-gray-700/50 p-4 rounded-md border-l-4 border-primary-teal">
                  <div className="flex items-start">
                    <HiOutlineInformationCircle className="w-5 h-5 text-primary-teal mt-0.5 mr-3 flex-shrink-0" />
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      Your email address and phone number will be made visible to anyone you are sparing for and anyone who is sparing for you.
                    </p>
                  </div>
                </div>

                {smsDisabled === false && (
                  <div className="p-4 rounded-md bg-gray-50 dark:bg-gray-700/40 border border-gray-200 dark:border-gray-600">
                    <div className="flex items-start">
                      <input
                        type="checkbox"
                        id="optedInSms"
                        checked={optedInSms}
                        onChange={(e) => setOptedInSms(e.target.checked)}
                        className="mt-1 mr-3 rounded border-gray-300 dark:border-gray-600 text-primary-teal focus:ring-primary-teal"
                      />
                      <label htmlFor="optedInSms" className="text-sm text-gray-700 dark:text-gray-200">
                        <span className="font-medium">Opt in to text messages</span>
                        <p className="text-gray-600 dark:text-gray-400 mt-1">
                          Receive text message notifications when new spare requests match your
                          availability and when someone has responded to your request. You can change this later. Message and data rates may apply. Reply STOP to any message to unsubscribe.
                        </p>
                      </label>
                    </div>
                  </div>
                )}

                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? 'Saving...' : 'Continue'}
                </Button>
              </form>
            )}

            {step === 2 && (
              <div className="space-y-6">
                <div className="text-center">
                  <div className="text-6xl mb-4">🥌</div>
                  <h2 className="text-2xl font-bold mb-2 text-[#121033] dark:text-gray-100">
                    You're all set!
                  </h2>
                  <p className="text-gray-600 dark:text-gray-400">
                    {(() => {
                      const pendingRequestId = sessionStorage.getItem('pendingSpareAcceptRequestId');
                      if (pendingRequestId) {
                        return "Next we'll take you back to confirm the spare request you were invited to.";
                      }
                      const pendingDeclineId = sessionStorage.getItem('pendingSpareDeclineRequestId');
                      if (pendingDeclineId) {
                        return "Next we'll take you back to decline the spare request you were invited to.";
                      }
                      return "Now let's set your sparing availability so others can find you when they need a spare.";
                    })()}
                  </p>
                </div>

                <Button onClick={handleComplete} disabled={loading} className="w-full">
                  {loading ? 'Loading...' : (() => {
                    const pendingRequestId = sessionStorage.getItem('pendingSpareAcceptRequestId');
                    if (pendingRequestId) return 'Continue to spare request';
                    const pendingDeclineId = sessionStorage.getItem('pendingSpareDeclineRequestId');
                    if (pendingDeclineId) return 'Continue to decline spare request';
                    return 'Set my availability';
                  })()}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
      
      <Footer simple />
    </div>
  );
}
