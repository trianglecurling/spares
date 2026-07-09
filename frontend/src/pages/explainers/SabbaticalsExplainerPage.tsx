import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PublicLayout from '../../components/PublicLayout';
import SeoMeta from '../../components/SeoMeta';
import api from '../../utils/api';

type PublicDuesScheduleFees = {
  sabbaticalFeeDollars: number;
};

const faqItems: Array<{ question: string; answer: string; accent: string }> = [
  {
    question: 'Can I play in other leagues while on sabbatical?',
    answer:
      'Yes. A sabbatical holds your return right for one league; it does not count as playing that league. You can still register to play in other leagues under the normal rules.',
    accent: 'border-t-sky-400 bg-gradient-to-b from-sky-50/80 to-white',
  },
  {
    question: 'Am I guaranteed to return to my spot?',
    answer:
      'Yes. Taking a sabbatical preserves your right to return to that league in a later session, as long as you stay within the duration limit and do not release the spot.',
    accent: 'border-t-teal-500 bg-gradient-to-b from-teal-50/80 to-white',
  },
  {
    question: 'Do I need a reason or documentation?',
    answer:
      'No. Member sabbaticals during priority registration do not require a reason or supporting documents.',
    accent: 'border-t-cyan-500 bg-gradient-to-b from-cyan-50/70 to-white',
  },
];

const alsoKnowItems: string[] = [
  'Your spot will be temporarily filled during your sabbatical. You cannot return mid-session.',
  'Each session you must choose to return, extend (and pay again), or permanently release the spot.',
  'Sabbaticals count toward the two protected claims you may hold (guaranteed returns and sabbaticals combined).',
  'Only returning members with a guaranteed return can take a sabbatical, and only during priority registration. Not available for build-your-own-team leagues (Tuesday and doubles).',
  'Failing to renew your sabbatical each session can mean losing your guaranteed return.',
];

function formatDollars(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

export default function SabbaticalsExplainerPage() {
  const [sabbaticalFeeDollars, setSabbaticalFeeDollars] = useState<number | null>(null);
  const [feeLoading, setFeeLoading] = useState(true);
  const [feeUnavailable, setFeeUnavailable] = useState(false);

  useEffect(() => {
    let canceled = false;
    setFeeLoading(true);
    setFeeUnavailable(false);

    void api
      .get<{ fees: PublicDuesScheduleFees }>('/public/dues')
      .then((response) => {
        if (canceled) return;
        const amount = response.data.fees.sabbaticalFeeDollars;
        if (typeof amount !== 'number' || Number.isNaN(amount)) {
          setSabbaticalFeeDollars(null);
          setFeeUnavailable(true);
          return;
        }
        setSabbaticalFeeDollars(amount);
      })
      .catch(() => {
        if (canceled) return;
        setSabbaticalFeeDollars(null);
        setFeeUnavailable(true);
      })
      .finally(() => {
        if (!canceled) setFeeLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, []);

  const feeLabel = sabbaticalFeeDollars != null ? formatDollars(sabbaticalFeeDollars) : null;

  return (
    <PublicLayout>
      <SeoMeta
        title="League sabbaticals | Triangle Curling Club"
        description="How league sabbaticals work: how to take one, cost, duration, return rights, and common questions."
        canonicalPath="/explainers/sabbaticals"
      />

      <div className="public-container public-section space-y-8">
        <section className="relative overflow-hidden rounded-3xl border border-teal-100 bg-gradient-to-br from-sky-50 via-white to-teal-50 p-6 sm:p-8 shadow-sm">
          <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-teal-200/40 blur-3xl" />
          <div className="pointer-events-none absolute -left-20 bottom-0 h-48 w-48 rounded-full bg-sky-200/50 blur-3xl" />
          <div className="relative space-y-3">
            <div className="public-page-title-rule mb-0">
              <h1 className="public-heading text-balance">League sabbaticals</h1>
            </div>
            <p className="public-body max-w-3xl text-base sm:text-lg">
              A sabbatical lets an eligible returning member step away from a standard league for a session while
              preserving the right to return later.
            </p>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <article className="relative overflow-hidden rounded-2xl border border-teal-100 bg-white p-5 shadow-sm sm:p-6">
            <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-teal-500 to-teal-300" aria-hidden />
            <div className="space-y-3 pl-2">
              <h2 className="public-subheading text-teal-900">How to take a sabbatical</h2>
              <ol className="list-decimal space-y-2 pl-5 text-sm text-gray-700 sm:text-base">
                <li>Start registration during the priority registration window.</li>
                <li>For a league where you have a guaranteed return, choose sabbatical instead of playing.</li>
                <li>If you are already on sabbatical, choose extend, return, or release the protected spot.</li>
                <li>Complete registration and pay the sabbatical fee when prompted.</li>
              </ol>
              <p className="text-sm text-teal-800/80">
                Sabbatical-only registration does not require purchasing regular membership for that session.
              </p>
              <p className="pt-1">
                <Link
                  to="/registration/start"
                  className="inline-flex rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300 focus-visible:ring-offset-2"
                >
                  Go to registration
                </Link>
              </p>
            </div>
          </article>

          <article className="relative overflow-hidden rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-5 shadow-sm sm:p-6">
            <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-amber-500 to-orange-300" aria-hidden />
            <div className="space-y-3 pl-2">
              <h2 className="public-subheading text-amber-950">Cost</h2>
              {feeLoading ? (
                <p className="text-sm text-amber-900/80 sm:text-base">Loading the current sabbatical fee…</p>
              ) : feeLabel ? (
                <div className="rounded-xl border border-amber-200/80 bg-white/80 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Per league, per session</p>
                  <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-amber-950">{feeLabel}</p>
                </div>
              ) : (
                <p className="text-sm text-amber-950 sm:text-base">
                  There is a sabbatical fee for each league, each session you remain on sabbatical
                  {feeUnavailable ? ' (current amount unavailable—see registration for the exact fee)' : ''}.
                </p>
              )}
              <div className="space-y-1 text-sm text-amber-950/90 sm:text-base">
                <p className="font-semibold text-amber-950">Why is there a fee?</p>
                <p>
                  The sabbatical fee serves to discount the league fee for the curler temporarily filling your spot.
                  Because they aren&apos;t receiving a guarantee to return to the league, their fees are reduced.
                </p>
              </div>
            </div>
          </article>

          <article className="relative overflow-hidden rounded-2xl border border-sky-100 bg-gradient-to-r from-sky-50 via-white to-cyan-50 p-5 shadow-sm sm:p-6 lg:col-span-2">
            <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-sky-500 to-cyan-300" aria-hidden />
            <div className="space-y-2 pl-2">
              <h2 className="public-subheading text-sky-950">How long can a sabbatical last?</h2>
              <p className="text-sm text-sky-950/90 sm:text-base">
                Sabbaticals can continue for up to <span className="font-semibold text-sky-900">three years</span> from
                the first day of play of the first session you took sabbatical. When the limit is reached, you must
                return or permanently release the spot. After a release, rejoining means going through the waitlist.
              </p>
            </div>
          </article>
        </section>

        <section className="space-y-4">
          <h2 className="public-subheading text-teal-950">Common questions</h2>
          <dl className="grid gap-4 sm:grid-cols-3">
            {faqItems.map((item) => (
              <div
                key={item.question}
                className={`space-y-2 rounded-2xl border border-gray-200 border-t-4 p-5 shadow-sm ${item.accent}`}
              >
                <dt className="text-sm font-semibold text-gray-900">{item.question}</dt>
                <dd className="text-sm text-gray-700">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="relative overflow-hidden rounded-2xl border border-teal-200 bg-gradient-to-br from-teal-50 via-emerald-50/60 to-sky-50 p-5 shadow-sm sm:p-6">
          <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-teal-200/40 blur-2xl" />
          <div className="relative space-y-3">
            <h2 className="text-base font-semibold text-teal-950">Also good to know</h2>
            <ul className="list-disc space-y-2 pl-5 text-sm text-teal-950/90">
              {alsoKnowItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </PublicLayout>
  );
}
