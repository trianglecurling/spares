import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout';
import SeoMeta from '../components/SeoMeta';
import api, { formatApiError } from '../utils/api';

type ConfirmState = 'working' | 'success' | 'error';

export default function PublicContactConfirmPage() {
  const [state, setState] = useState<ConfirmState>('working');
  const [message, setMessage] = useState('Enter the email address and confirmation code from your email.');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedEmail = email.trim();
    const trimmedCode = code.trim();
    if (!trimmedEmail || !trimmedCode) {
      setState('error');
      setMessage('Enter your email address and confirmation code.');
      return;
    }

    setSubmitting(true);
    setState('working');
    setMessage('Confirming your message and sending it now...');
    try {
      await api.post('/public/contact/confirm', { email: trimmedEmail, code: trimmedCode });
      setState('success');
      setMessage('');
    } catch (error: unknown) {
      setState('error');
      setMessage(formatApiError(error, 'Unable to confirm this message'));
    } finally {
      setSubmitting(false);
    }
  };

  const pageTitle =
    state === 'success'
      ? 'Message sent | Triangle Curling Club'
      : 'Contact Confirmation | Triangle Curling Club';

  return (
    <PublicLayout>
      <SeoMeta
        title={pageTitle}
        description="Confirmation status for your Triangle Curling Club contact message."
        canonicalPath="/contact/confirm"
      />

      <div className="public-container public-section">
        <div className="mx-auto max-w-2xl">
          <section className="public-card p-7 sm:p-9">
            <div className="public-page-title-rule">
              <h1 className="public-heading">
                {state === 'success' ? 'Message sent' : 'Contact Confirmation'}
              </h1>
            </div>

            {state === 'success' ? (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-5 text-emerald-900">
                <p className="text-sm font-medium">Your message was sent successfully.</p>
                <p className="mt-3 text-sm">
                  If you need a reply, you should typically hear back within 48 hours.
                </p>
              </div>
            ) : (
              <>
                <p
                  className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
                    state === 'error'
                      ? 'border-red-200 bg-red-50 text-red-800'
                      : 'border-sky-200 bg-sky-50 text-sky-800'
                  }`}
                >
                  {message}
                </p>
                <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                  <div>
                    <label htmlFor="contactConfirmEmail" className="app-label">
                      Email address
                    </label>
                    <input
                      id="contactConfirmEmail"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="app-input"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="contactConfirmCode" className="app-label">
                      Confirmation code
                    </label>
                    <input
                      id="contactConfirmCode"
                      type="text"
                      inputMode="numeric"
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      className="app-input"
                      minLength={6}
                      maxLength={6}
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting ? 'Sending...' : 'Send message'}
                  </button>
                </form>
              </>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                to="/contact"
                className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
              >
                Back to contact page
              </Link>
              <Link
                to="/"
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Go to homepage
              </Link>
            </div>
          </section>
        </div>
      </div>
    </PublicLayout>
  );
}
