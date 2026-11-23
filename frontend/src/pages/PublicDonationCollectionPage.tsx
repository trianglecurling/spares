import { FormEvent, useEffect, useId, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArticleMarkdown } from '../components/ArticleMarkdown';
import FormField from '../components/FormField';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import SeoMeta from '../components/SeoMeta';
import api, { formatApiError } from '../utils/api';
import { donationCheckoutIntro, donationCheckoutStepTwo } from '../utils/paymentProcessorCopy';

type PublicDonationCollection = {
  name: string;
  slug: string;
  causeName: string;
  description: string | null;
  startDate: string;
  endDate: string;
  minimumAmountMinor: number;
  status: 'upcoming' | 'open' | 'ended';
};

function formatMoney(amountMinor: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amountMinor / 100);
}

function formatYmd(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function dollarsToMinor(value: string): number | null {
  const normalized = value.replace(/[^0-9.]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100);
}

function feeNote(causeName: string): string {
  return `Your full donation amount will be collected for ${causeName}, less any credit card processing fees (about 3%).`;
}

export default function PublicDonationCollectionPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const baseId = useId();
  const [collection, setCollection] = useState<PublicDonationCollection | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [amount, setAmount] = useState('');
  const [donorName, setDonorName] = useState('');
  const [donorEmail, setDonorEmail] = useState('');
  const [donorPhone, setDonorPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setNotFound(false);
    api
      .get<{ collection: PublicDonationCollection }>(`/public/donation-collections/${encodeURIComponent(slug)}`)
      .then((response) => {
        if (cancelled) return;
        const next = response.data.collection;
        setCollection(next);
        const defaultDollars = Math.max(next.minimumAmountMinor, 5000) / 100;
        setAmount(defaultDollars.toFixed(2));
      })
      .catch((loadFailure) => {
        if (cancelled) return;
        const status = (loadFailure as { response?: { status?: number } })?.response?.status;
        if (status === 404) {
          setNotFound(true);
          return;
        }
        setLoadError(formatApiError(loadFailure, 'Unable to load this donation page.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const amountMinor = useMemo(() => dollarsToMinor(amount), [amount]);
  const open = collection?.status === 'open';
  const canSubmit = Boolean(
    open &&
      collection &&
      amountMinor != null &&
      amountMinor >= collection.minimumAmountMinor &&
      donorName.trim() &&
      donorEmail.trim() &&
      donorPhone.trim() &&
      !submitting
  );

  const suggestedAmounts = [25, 50, 100, 250, 500].filter(
    (value) => collection != null && value * 100 >= collection.minimumAmountMinor
  );

  const closedMessage =
    collection?.status === 'upcoming'
      ? `Donations open on ${formatYmd(collection.startDate)}.`
      : collection?.status === 'ended'
        ? 'This donation collection has ended.'
        : null;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || !collection || amountMinor == null) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await api.post(`/public/donation-collections/${encodeURIComponent(collection.slug)}/checkout`, {
        amountMinor,
        donorName: donorName.trim(),
        donorEmail: donorEmail.trim(),
        donorPhone: donorPhone.trim(),
      });
      const checkoutUrl = response.data?.checkoutUrl;
      if (typeof checkoutUrl !== 'string' || checkoutUrl.trim().length === 0) {
        throw new Error('Missing checkout URL from server response');
      }
      window.location.assign(checkoutUrl);
    } catch (submitError) {
      setError(formatApiError(submitError, 'Unable to start donation checkout'));
      setSubmitting(false);
    }
  };

  return (
    <PublicLayout>
      <SeoMeta
        title={collection ? `${collection.name} | Donate` : 'Donate | Triangle Curling Club'}
        description={
          collection
            ? `Donate to ${collection.causeName} through Triangle Curling Club.`
            : 'Donate through Triangle Curling Club.'
        }
        canonicalPath={slug ? `/donations/${slug}` : '/donations'}
      />
      <div className="public-container public-section space-y-8">
        {loading ? (
          <PublicStateCard title="Loading donation page…" />
        ) : notFound ? (
          <PublicStateCard title="Donation page not found" description="Check the link and try again." tone="error" />
        ) : loadError ? (
          <PublicStateCard title="Unable to load this donation page" description={loadError} tone="error" />
        ) : collection ? (
          <>
            <section className="public-card space-y-4 p-6 sm:p-8">
              <div className="public-page-title-rule">
                <h1 className="public-heading text-balance">{collection.name}</h1>
              </div>
              <p className="public-body">
                Fundraising for <strong>{collection.causeName}</strong>. Open {formatYmd(collection.startDate)} through{' '}
                {formatYmd(collection.endDate)}.
              </p>
              {collection.description ? (
                <ArticleMarkdown markdown={collection.description} className="markdown-content max-w-none" />
              ) : null}
              <p className="text-sm text-gray-700">{feeNote(collection.causeName)}</p>
              <p className="text-sm text-gray-600">{donationCheckoutIntro()}</p>
            </section>

            <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <form onSubmit={handleSubmit} className="public-card space-y-5 p-6 sm:p-7">
                <FormField
                  tone="public"
                  label="Donation amount (USD)"
                  htmlFor={`${baseId}-amount`}
                  required
                  error={
                    open && amountMinor != null && amountMinor < collection.minimumAmountMinor
                      ? `Minimum donation is ${formatMoney(collection.minimumAmountMinor)}.`
                      : undefined
                  }
                  helperText={`Minimum donation is ${formatMoney(collection.minimumAmountMinor)}.`}
                  state={open ? 'default' : 'disabled'}
                  stateMessage={closedMessage ?? undefined}
                >
                  <input
                    id={`${baseId}-amount`}
                    className="app-input"
                    inputMode="decimal"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    required
                    disabled={!open || submitting}
                  />
                </FormField>
                {open && suggestedAmounts.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {suggestedAmounts.map((value) => (
                      <button
                        key={value}
                        type="button"
                        className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
                        onClick={() => setAmount(value.toFixed(2))}
                      >
                        ${value}
                      </button>
                    ))}
                  </div>
                ) : null}
                <FormField tone="public" label="Name" htmlFor={`${baseId}-name`} required state={open ? 'default' : 'disabled'}>
                  <input
                    id={`${baseId}-name`}
                    className="app-input"
                    value={donorName}
                    onChange={(event) => setDonorName(event.target.value)}
                    required
                    maxLength={120}
                    disabled={!open || submitting}
                  />
                </FormField>
                <FormField
                  tone="public"
                  label="Email"
                  htmlFor={`${baseId}-email`}
                  required
                  helperText="We send your confirmation and receipt link to this address."
                  state={open ? 'default' : 'disabled'}
                >
                  <input
                    id={`${baseId}-email`}
                    type="email"
                    className="app-input"
                    value={donorEmail}
                    onChange={(event) => setDonorEmail(event.target.value)}
                    required
                    maxLength={320}
                    disabled={!open || submitting}
                  />
                </FormField>
                <FormField tone="public" label="Phone" htmlFor={`${baseId}-phone`} required state={open ? 'default' : 'disabled'}>
                  <input
                    id={`${baseId}-phone`}
                    type="tel"
                    className="app-input"
                    value={donorPhone}
                    onChange={(event) => setDonorPhone(event.target.value)}
                    required
                    maxLength={40}
                    disabled={!open || submitting}
                  />
                </FormField>
                {error ? (
                  <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>
                ) : null}
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="inline-flex items-center rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? 'Redirecting to checkout…' : 'Continue to secure checkout'}
                </button>
              </form>
              <aside className="public-card p-6 sm:p-7">
                <h2 className="public-subheading">How it works</h2>
                <ol className="mt-4 space-y-3 text-sm text-gray-700">
                  <li className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">1) Enter your donation amount and contact details.</li>
                  <li className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">2) {donationCheckoutStepTwo()}</li>
                  <li className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                    3) Return here for confirmation. A receipt link is emailed to you.
                  </li>
                </ol>
                <div className="mt-6">
                  <Link to="/" className="text-sm font-semibold text-emerald-800 hover:underline">
                    Back to homepage
                  </Link>
                </div>
              </aside>
            </section>
          </>
        ) : null}
      </div>
    </PublicLayout>
  );
}
