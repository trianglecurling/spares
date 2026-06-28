import { FormEvent, useId, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import FormField from '../components/FormField';
import PublicLayout from '../components/PublicLayout';
import SeoMeta from '../components/SeoMeta';
import PublicNotFoundPage from './PublicNotFoundPage';
import api, { formatApiError } from '../utils/api';

const publicInputClass =
  'w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200';

type MailingListSlug = 'bonspiels' | 'membership' | 'learn-to-curl';

const LIST_SLUGS = new Set<MailingListSlug>(['bonspiels', 'membership', 'learn-to-curl']);

const LIST_COPY: Record<
  MailingListSlug,
  { title: string; description: string; subscribeLabel: string }
> = {
  bonspiels: {
    title: 'Bonspiel notifications',
    description: 'Get email updates about upcoming bonspiels, registration windows, and related club events.',
    subscribeLabel: 'Bonspiel mailing list',
  },
  membership: {
    title: 'Membership interest',
    description:
      'Hear from us about league play, annual membership, and how to get involved as a member at the club.',
    subscribeLabel: 'Membership interest list',
  },
  'learn-to-curl': {
    title: 'Learn to curl notifications',
    description: 'We will email you about learn-to-curl sessions, new dates, and beginner opportunities.',
    subscribeLabel: 'Learn to curl mailing list',
  },
};

function isMailingListSlug(value: string | undefined): value is MailingListSlug {
  return value != null && LIST_SLUGS.has(value as MailingListSlug);
}

export default function PublicMailingListPage() {
  const { listSlug = '' } = useParams();
  const idPrefix = useId();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const listInfo = isMailingListSlug(listSlug) ? LIST_COPY[listSlug] : null;

  const canSubmit = useMemo(() => {
    return fullName.trim().length >= 2 && email.trim().length > 0 && !submitting;
  }, [email, fullName, submitting]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || !listInfo) return;

    setSubmitting(true);
    setResult(null);

    try {
      await api.post('/public/mailing-list/subscribe', {
        list: listSlug,
        fullName: fullName.trim(),
        email: email.trim(),
        website: website.trim(),
      });
      setResult({
        kind: 'success',
        message:
          'You are signed up for our Membership Interest mailing list.',
      });
    } catch (error: unknown) {
      setResult({
        kind: 'error',
        message: formatApiError(error, 'We could not complete your sign-up'),
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (!listInfo) {
    return (
      <PublicNotFoundPage
        title="Mailing list not found"
        description="This page does not exist. Use a link from our website, or return home to browse programs and events."
        seoTitle="Mailing list not found | Triangle Curling Club"
        showCode={false}
      />
    );
  }

  return (
    <PublicLayout>
      <SeoMeta
        title={`${listInfo.title} | Triangle Curling Club`}
        description={listInfo.description}
        canonicalPath={`/mailing-list/${listSlug}`}
      />

      <div className="public-container public-section space-y-8">
        <section className="relative overflow-hidden rounded-3xl border border-teal-100 bg-gradient-to-br from-sky-50 via-white to-teal-50 p-6 sm:p-8 lg:p-10 shadow-sm">
          <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-teal-200/40 blur-3xl" />
          <div className="pointer-events-none absolute -left-24 bottom-0 h-52 w-52 rounded-full bg-sky-200/50 blur-3xl" />
          <div className="relative max-w-3xl space-y-4">
            <div className="public-page-title-rule">
              <h1 className="public-heading text-balance">{listInfo.title}</h1>
            </div>
            <p className="public-body text-base sm:text-lg">{listInfo.description}</p>
            <p className="text-sm text-gray-600">
              We only use your name and email to send messages related to <strong>{listInfo.subscribeLabel}</strong>.
              You can unsubscribe at any time using the link in our emails.
            </p>
          </div>
        </section>

        <section className="public-card p-6 sm:p-7 max-w-xl">
          {result && (
            <div
              className={`mb-6 rounded-xl border p-4 text-sm ${
                result.kind === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              {result.message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <FormField
              tone="public"
              label="Full name"
              htmlFor={`${idPrefix}-name`}
              required
              labelClassName="font-semibold"
            >
              <input
                id={`${idPrefix}-name`}
                type="text"
                name="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                autoComplete="name"
                className={publicInputClass}
                disabled={result?.kind === 'success'}
              />
            </FormField>

            <FormField
              tone="public"
              label="Email"
              htmlFor={`${idPrefix}-email`}
              required
              labelClassName="font-semibold"
            >
              <input
                id={`${idPrefix}-email`}
                type="email"
                name="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className={publicInputClass}
                disabled={result?.kind === 'success'}
              />
            </FormField>

            <div className="hidden" aria-hidden>
              <label htmlFor={`${idPrefix}-website`}>Website</label>
              <input
                id={`${idPrefix}-website`}
                type="text"
                name="website"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                tabIndex={-1}
                autoComplete="off"
              />
            </div>

            <div>
              <button
                type="submit"
                className="inline-flex w-full sm:w-auto min-h-[2.75rem] items-center justify-center rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!canSubmit || result?.kind === 'success'}
              >
                {submitting ? 'Signing up…' : 'Sign up'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </PublicLayout>
  );
}
