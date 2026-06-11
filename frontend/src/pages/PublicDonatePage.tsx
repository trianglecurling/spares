import { FormEvent, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout';
import SeoMeta from '../components/SeoMeta';
import api, { formatApiError } from '../utils/api';
import { donationCheckoutIntro, donationCheckoutStepTwo } from '../utils/paymentProcessorCopy';

const suggestedAmounts = [25, 50, 100, 250];

function toAmountMinor(value: string): number | null {
  const normalized = value.replace(/[^0-9.]/g, '');
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100);
}

export default function PublicDonatePage() {
  const [amount, setAmount] = useState('50');
  const [donorName, setDonorName] = useState('');
  const [donorEmail, setDonorEmail] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountMinor = useMemo(() => toAmountMinor(amount), [amount]);
  const canSubmit = Boolean(amountMinor && amountMinor >= 100 && donorEmail.trim().length > 0 && !submitting);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || !amountMinor) return;

    setSubmitting(true);
    setError(null);
    try {
      const response = await api.post('/public/donations/checkout', {
        amountMinor,
        donorName: donorName.trim() || undefined,
        donorEmail: donorEmail.trim(),
        message: message.trim() || undefined,
      });

      const checkoutUrl = response.data?.checkoutUrl;
      if (typeof checkoutUrl !== 'string' || checkoutUrl.trim().length === 0) {
        throw new Error('Missing checkout URL from server response');
      }
      window.location.assign(checkoutUrl);
    } catch (submitError: unknown) {
      setError(formatApiError(submitError, 'Unable to start donation checkout'));
      setSubmitting(false);
    }
  };

  return (
    <PublicLayout>
      <SeoMeta
        title="Donate | Triangle Curling Club"
        description="Support Triangle Curling Club with a secure online donation."
        canonicalPath="/donate"
      />

      <div className="public-container public-section space-y-8">
        <section className="relative overflow-hidden rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-sky-50 p-6 sm:p-8 lg:p-10 shadow-sm">
          <div className="pointer-events-none absolute -left-16 top-6 h-40 w-40 rounded-full bg-emerald-200/50 blur-3xl" />
          <div className="pointer-events-none absolute -right-24 -bottom-16 h-56 w-56 rounded-full bg-sky-200/50 blur-3xl" />
          <div className="relative max-w-3xl space-y-4">
            <p className="inline-flex rounded-full bg-emerald-600/10 px-3 py-1 text-sm font-semibold text-emerald-800">
              501(c)(3) nonprofit • Donations are tax-deductible
            </p>
            <div className="public-page-title-rule">
              <h1 className="public-heading text-balance">Support curling in the Triangle</h1>
            </div>
            <p className="public-body text-base sm:text-lg">
              Your donation helps us grow learn-to-curl programs, maintain our dedicated facility, and keep the sport
              accessible for our community.
            </p>
            <p className="text-sm text-emerald-900/80">{donationCheckoutIntro()}</p>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <form onSubmit={handleSubmit} className="public-card p-6 sm:p-7 space-y-6">
            <div>
              <label htmlFor="donation-amount" className="mb-2 block text-sm font-semibold text-gray-700">
                Donation amount (USD)
              </label>
              <input
                id="donation-amount"
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="50.00"
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                required
              />
              <p className="mt-2 text-xs text-gray-500">Minimum donation is $1.00.</p>
            </div>

            <div className="flex flex-wrap gap-2">
              {suggestedAmounts.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
                  onClick={() => setAmount(String(value))}
                >
                  ${value}
                </button>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="donor-name" className="mb-2 block text-sm font-semibold text-gray-700">
                  Name (optional)
                </label>
                <input
                  id="donor-name"
                  type="text"
                  value={donorName}
                  onChange={(event) => setDonorName(event.target.value)}
                  maxLength={120}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                />
              </div>
              <div>
                <label htmlFor="donor-email" className="mb-2 block text-sm font-semibold text-gray-700">
                  Email (required for receipt)
                </label>
                <input
                  id="donor-email"
                  type="email"
                  value={donorEmail}
                  onChange={(event) => setDonorEmail(event.target.value)}
                  maxLength={320}
                  required
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                />
              </div>
            </div>

            <div>
              <label htmlFor="donor-message" className="mb-2 block text-sm font-semibold text-gray-700">
                Message (optional)
              </label>
              <textarea
                id="donor-message"
                rows={3}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                maxLength={500}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
              />
            </div>

            {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}

            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex items-center rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Redirecting to checkout...' : 'Continue to secure checkout'}
            </button>
          </form>

          <aside className="public-card p-6 sm:p-7">
            <h2 className="public-subheading">How it works</h2>
            <ol className="mt-4 space-y-3 text-sm text-gray-700">
              <li className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">1) Enter your donation amount.</li>
              <li className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">2) {donationCheckoutStepTwo()}</li>
              <li className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                3) Return here for confirmation and receipt status.
              </li>
            </ol>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                to="/"
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Back to homepage
              </Link>
            </div>
          </aside>
        </section>
      </div>
    </PublicLayout>
  );
}
