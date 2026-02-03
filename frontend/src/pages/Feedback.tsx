import { useEffect, useMemo, useState } from 'react';
import { get, post } from '../api/client';
import { formatApiError } from '../utils/api';
import Footer from '../components/Footer';
import HelpHeader from '../components/HelpHeader';
import Button from '../components/Button';
import { useAuth } from '../contexts/AuthContext';

type FeedbackCategory = 'suggestion' | 'problem' | 'question' | 'general';

const categoryOptions: { value: FeedbackCategory; label: string }[] = [
  { value: 'suggestion', label: 'Suggestion' },
  { value: 'problem', label: 'Problem' },
  { value: 'question', label: 'Question' },
  { value: 'general', label: 'General feedback' },
];

export default function Feedback() {
  const { member } = useAuth();

  const [category, setCategory] = useState<FeedbackCategory>('problem');
  const [email, setEmail] = useState('');
  const [body, setBody] = useState('');

  const [captchaQuestion, setCaptchaQuestion] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');

  const [loadingCaptcha, setLoadingCaptcha] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isLoggedIn = !!member;

  const canSubmit = useMemo(() => {
    if (!body.trim()) return false;
    if (!isLoggedIn) {
      if (!captchaToken) return false;
      if (!captchaAnswer.trim()) return false;
    }
    return true;
  }, [body, isLoggedIn, captchaToken, captchaAnswer]);

  const loadCaptcha = async () => {
    setLoadingCaptcha(true);
    try {
      const res = await get('/feedback/captcha');
      setCaptchaQuestion(res.question);
      setCaptchaToken(res.token);
      setCaptchaAnswer('');
    } catch (e) {
      console.error('Failed to load CAPTCHA:', e);
      setCaptchaQuestion(null);
      setCaptchaToken(null);
      // Don't clear any existing submit message; only show an error if there isn't one.
      setMessage((prev) => prev ?? { type: 'error', text: 'Failed to load CAPTCHA. Please try again.' });
    } finally {
      setLoadingCaptcha(false);
    }
  };

  useEffect(() => {
    if (!isLoggedIn) {
      setMessage(null);
      loadCaptcha();
    } else {
      setCaptchaQuestion(null);
      setCaptchaToken(null);
      setCaptchaAnswer('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);

    try {
      await post('/feedback', {
        category,
        email: isLoggedIn ? undefined : email || undefined,
        body,
        captchaToken: isLoggedIn ? undefined : captchaToken || undefined,
        captchaAnswer: isLoggedIn ? undefined : captchaAnswer,
        pagePath: window.location.pathname,
      });

      setMessage({ type: 'success', text: 'Thanks! Your feedback has been submitted.' });
      setBody('');
      setEmail('');
      if (!isLoggedIn) {
        await loadCaptcha();
      }
    } catch (error: unknown) {
      setMessage({ type: 'error', text: formatApiError(error, 'Failed to submit feedback') });
      if (!isLoggedIn) {
        // If captcha failed/expired, refresh it for a smoother retry
        await loadCaptcha();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <HelpHeader />

      <div className="flex-grow">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h1 className="text-3xl font-bold mb-2 text-[#121033] dark:text-gray-100">
              Report issues / feedback
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Tell us what’s going on. The more detail you can share, the easier it is to fix.
            </p>

            {message && (
              <div
                className={`mb-6 p-4 rounded ${
                  message.type === 'success'
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200'
                    : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
                }`}
              >
                {message.text}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Category
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                >
                  {categoryOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {!isLoggedIn && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Your email (optional)
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    If you include an email, admins can follow up with you.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Details
                </label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={8}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                  placeholder="What happened? What did you expect to happen? Any steps to reproduce?"
                />
              </div>

              {!isLoggedIn && (
                <div className="border-t dark:border-gray-700 pt-6 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      CAPTCHA
                    </div>
                    <Button type="button" variant="secondary" onClick={loadCaptcha} disabled={loadingCaptcha}>
                      {loadingCaptcha ? 'Loading…' : 'New question'}
                    </Button>
                  </div>

                  <div className="text-gray-600 dark:text-gray-400">
                    {captchaQuestion || 'Loading…'}
                  </div>
                  <input
                    type="text"
                    value={captchaAnswer}
                    onChange={(e) => setCaptchaAnswer(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                    placeholder="Answer"
                    inputMode="numeric"
                  />
                </div>
              )}

              <div className="flex justify-end">
                <Button type="submit" disabled={!canSubmit || submitting}>
                  {submitting ? 'Submitting…' : 'Submit'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}

