import { FormEvent, useEffect, useId, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import FormField from '../components/FormField';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import SeoMeta from '../components/SeoMeta';
import PublicNotFoundPage from './PublicNotFoundPage';
import api, { formatApiError } from '../utils/api';

const publicInputClass =
  'w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200';

type PublicMailingListInfo = {
  slug: string;
  name: string;
  description: string;
  includeQuestionsComments: boolean;
  subscribeAvailable: boolean;
};

export default function PublicMailingListPage() {
  const { listSlug = '' } = useParams();
  const idPrefix = useId();
  const [listInfo, setListInfo] = useState<PublicMailingListInfo | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listNotFound, setListNotFound] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [comments, setComments] = useState('');
  const [website, setWebsite] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    const slug = listSlug.trim().toLowerCase();
    if (!slug) {
      setListLoading(false);
      setListNotFound(true);
      return;
    }

    let cancelled = false;
    setListLoading(true);
    setListNotFound(false);

    void api
      .get<PublicMailingListInfo>(`/public/mailing-lists/${encodeURIComponent(slug)}`)
      .then((response) => {
        if (cancelled) return;
        setListInfo(response.data);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status === 404) {
          setListNotFound(true);
          setListInfo(null);
          return;
        }
        setListInfo(null);
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [listSlug]);

  const canSubmit = useMemo(() => {
    return fullName.trim().length >= 2 && email.trim().length > 0 && !submitting;
  }, [email, fullName, submitting]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || !listInfo) return;

    setSubmitting(true);
    setResult(null);

    const payload: {
      list: string;
      fullName: string;
      email: string;
      website: string;
      comments?: string;
    } = {
      list: listSlug.trim().toLowerCase(),
      fullName: fullName.trim(),
      email: email.trim(),
      website: website.trim(),
    };

    const trimmedComments = comments.trim();
    if (trimmedComments) {
      payload.comments = trimmedComments;
    }

    try {
      await api.post('/public/mailing-list/subscribe', payload);
      setResult({
        kind: 'success',
        message: `You are signed up for ${listInfo.name}.`,
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

  if (listLoading) {
    return (
      <PublicLayout>
        <div className="public-container public-section">
          <PublicStateCard title="Loading mailing list..." />
        </div>
      </PublicLayout>
    );
  }

  if (listNotFound || !listInfo) {
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
        title={`${listInfo.name} | Triangle Curling Club`}
        description={listInfo.description}
        canonicalPath={`/mailing-list/${listSlug}`}
      />

      <div className="public-container public-section space-y-8">
        <section className="relative overflow-hidden rounded-3xl border border-teal-100 bg-gradient-to-br from-sky-50 via-white to-teal-50 p-6 sm:p-8 lg:p-10 shadow-sm">
          <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-teal-200/40 blur-3xl" />
          <div className="pointer-events-none absolute -left-24 bottom-0 h-52 w-52 rounded-full bg-sky-200/50 blur-3xl" />
          <div className="relative max-w-3xl space-y-4">
            <div className="public-page-title-rule">
              <h1 className="public-heading text-balance">{listInfo.name}</h1>
            </div>
            <p className="public-body text-base sm:text-lg">{listInfo.description}</p>
            <p className="text-sm text-gray-600">
              We only use your name and email to send messages related to <strong>{listInfo.name}</strong>.
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

          {!listInfo.subscribeAvailable && result?.kind !== 'success' ? (
            <p className="text-sm text-gray-700">
              Mailing list sign-up is not available right now. Please try again later.
            </p>
          ) : (
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

              {listInfo.includeQuestionsComments ? (
                <FormField
                  tone="public"
                  label="Questions or comments"
                  htmlFor={`${idPrefix}-comments`}
                  helperText="Optional. If necessary, we will reach out within the next few days."
                  labelClassName="font-semibold"
                >
                  <textarea
                    id={`${idPrefix}-comments`}
                    name="comments"
                    value={comments}
                    onChange={(e) => setComments(e.target.value)}
                    rows={4}
                    className={`${publicInputClass} min-h-[6rem]`}
                    disabled={result?.kind === 'success'}
                  />
                </FormField>
              ) : null}

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
          )}
        </section>
      </div>
    </PublicLayout>
  );
}
