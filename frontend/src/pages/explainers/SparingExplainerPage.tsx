import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import PublicLayout from '../../components/PublicLayout';
import SeoMeta from '../../components/SeoMeta';

const faqItems: Array<{ question: string; answer: ReactNode; accent: string }> = [
  {
    question: 'Does the spare have to play a particular position?',
    answer:
      'Most leagues allow spares to play any position, but check with your league coordinator to confirm.',
    accent: 'border-t-sky-400 bg-gradient-to-b from-sky-50/80 to-white',
  },
  {
    question: 'What is the difference between a public and a private spare request?',
    answer:
      'Public spare requests are open to all club members. Members are notified based on their availability settings, starting with any players on bye for that league. Private requests go only to people you invite. Your teammates are notified either way, and the spot goes to the first person to claim it.',
    accent: 'border-t-teal-500 bg-gradient-to-b from-teal-50/80 to-white',
  },
  {
    question: 'How do notifications work?',
    answer: (
      <div className="space-y-3">
        <p>
          Your teammates always get email updates when a request is created, filled, or cancelled.
          Notifications for private requests are always sent simultaneously and immediately after the
          spare request is created.
        </p>
        <div className="space-y-1">
          <p className="font-medium text-gray-900">For public requests:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Members on bye for that week are emailed first.</li>
            <li>
              After a waiting period:
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>The request shows up on all member dashboards.</li>
                <li>
                  Notifications are slowly sent out to the randomized list of available spares for
                  that league.
                </li>
              </ul>
            </li>
            <li>As soon as someone signs up for the spot, the notification process halts.</li>
          </ol>
        </div>
        <p>
          Note: Public spare requests created close to game time may have notifications roll out much more
          quickly.
        </p>
      </div>
    ),
    accent: 'border-t-cyan-500 bg-gradient-to-b from-cyan-50/70 to-white',
  },
];

export default function SparingExplainerPage() {
  return (
    <PublicLayout>
      <SeoMeta
        title="Sparing | Triangle Curling Club"
        description="How sparing works: request a spare for one league game, choose public or private, and fill the spot."
        canonicalPath="/explainers/sparing"
      />

      <div className="public-container public-section space-y-8">
        <section className="relative overflow-hidden rounded-3xl border border-teal-100 bg-gradient-to-br from-sky-50 via-white to-teal-50 p-6 sm:p-8 shadow-sm">
          <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-teal-200/40 blur-3xl" />
          <div className="pointer-events-none absolute -left-20 bottom-0 h-48 w-48 rounded-full bg-sky-200/50 blur-3xl" />
          <div className="relative space-y-3">
            <div className="public-page-title-rule mb-0">
              <h1 className="public-heading text-balance">Sparing</h1>
            </div>
            <p className="public-body max-w-3xl text-base sm:text-lg">
              Sparing is how a team finds a temporary replacement for one league game.
            </p>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <article className="relative overflow-hidden rounded-2xl border border-teal-100 bg-white p-5 shadow-sm sm:p-6">
            <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-teal-500 to-teal-300" aria-hidden />
            <div className="space-y-3 pl-2">
              <h2 className="public-subheading text-teal-900">How to request a spare</h2>
              <ol className="list-decimal space-y-2 pl-5 text-sm text-gray-700 sm:text-base">
                <li>Choose the league and who needs covering.</li>
                <li>Choose the upcoming game.</li>
                <li>Choose public or private, then submit.</li>
              </ol>
              <p className="pt-1">
                <Link
                  to="/request-spare"
                  className="inline-flex rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300 focus-visible:ring-offset-2"
                >
                  Request a spare
                </Link>
              </p>
            </div>
          </article>

          <article className="relative overflow-hidden rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-5 shadow-sm sm:p-6">
            <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-amber-500 to-orange-300" aria-hidden />
            <div className="space-y-3 pl-2">
              <h2 className="public-subheading text-amber-950">How to respond to a spare request</h2>
              <div className="space-y-2 text-sm text-amber-950 sm:text-base">
                <p>
                  If you get an email about a request, use the link in the message to sign up (or
                  decline, for a private invite).
                </p>
                <p>
                  You can also sign up from{' '}
                  <span className="font-semibold">Outstanding spare requests</span> on your{' '}
                  <Link to="/dashboard" className="font-semibold text-amber-900 underline hover:text-amber-950">
                    dashboard
                  </Link>
                  .
                </p>
              </div>
            </div>
          </article>
        </section>

        <section className="space-y-4">
          <h2 className="public-subheading text-teal-950">Common questions</h2>
          <dl className="grid gap-4 sm:grid-cols-2">
            {faqItems.slice(0, 2).map((item) => (
              <div
                key={item.question}
                className={`space-y-2 rounded-2xl border border-gray-200 border-t-4 p-5 shadow-sm ${item.accent}`}
              >
                <dt className="text-sm font-semibold text-gray-900">{item.question}</dt>
                <dd className="text-sm text-gray-700">{item.answer}</dd>
              </div>
            ))}
            {faqItems.slice(2).map((item) => (
              <div
                key={item.question}
                className={`space-y-2 rounded-2xl border border-gray-200 border-t-4 p-5 shadow-sm sm:col-span-2 ${item.accent}`}
              >
                <dt className="text-sm font-semibold text-gray-900">{item.question}</dt>
                <dd className="text-sm text-gray-700">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </PublicLayout>
  );
}
