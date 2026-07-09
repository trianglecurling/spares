import { Link } from 'react-router-dom';
import PublicLayout from '../../components/PublicLayout';
import SeoMeta from '../../components/SeoMeta';

const faqItems: Array<{ question: string; answer: string; accent: string }> = [
  {
    question: 'Do I need to be a member to join?',
    answer:
      "No. You need a user account and must meet the league's eligibility rules, but you do not need paid membership to join a waitlist.",
    accent: 'border-t-sky-400 bg-gradient-to-b from-sky-50/80 to-white',
  },
  {
    question: 'What if I ignore an offer email?',
    answer:
      'If you do not decline within 24 hours, the offer is treated as accepted and you are added to the league. Staff will follow up about payment if needed.',
    accent: 'border-t-teal-500 bg-gradient-to-b from-teal-50/80 to-white',
  },
  {
    question: "What's the difference between ADD and REPLACE?",
    answer:
      'ADD means you want the league as your first or second league. REPLACE means you would give up a league you already hold to take this one. You can have at most two REPLACE waitlists.',
    accent: 'border-t-cyan-500 bg-gradient-to-b from-cyan-50/70 to-white',
  },
];

const alsoKnowItems: string[] = [
  'Waitlists are first-come, first-served and can carry forward across sessions when leagues have successor relationships.',
  'You may remove yourself from a waitlist at any time, but you lose your position; re-joining starts at the back with a fresh decline count.',
  'Permanent spots are offered before temporary sabbatical-fill spots.',
  'Joining a waitlist defers payment until placement is known.',
  'Not available for build-your-own-team leagues (Tuesday and doubles), Junior Recreational, or third-league interest (those use different paths).',
];

export default function WaitlistsExplainerPage() {
  return (
    <PublicLayout>
      <SeoMeta
        title="League waitlists | Triangle Curling Club"
        description="How league waitlists work: how to join, offers, declines, ADD vs REPLACE, and common questions."
        canonicalPath="/explainers/waitlists"
      />

      <div className="public-container public-section space-y-8">
        <section className="relative overflow-hidden rounded-3xl border border-teal-100 bg-gradient-to-br from-sky-50 via-white to-teal-50 p-6 sm:p-8 shadow-sm">
          <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-teal-200/40 blur-3xl" />
          <div className="pointer-events-none absolute -left-20 bottom-0 h-48 w-48 rounded-full bg-sky-200/50 blur-3xl" />
          <div className="relative space-y-3">
            <div className="public-page-title-rule mb-0">
              <h1 className="public-heading text-balance">League waitlists</h1>
            </div>
            <p className="public-body max-w-3xl text-base sm:text-lg">
              A league waitlist records your interest in joining a standard league when it is full. You join during
              registration; when a spot opens, you may receive an offer. Vacancies and waitlists are processed after the
              priority registration period each session.
            </p>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <article className="relative overflow-hidden rounded-2xl border border-teal-100 bg-white p-5 shadow-sm sm:p-6">
            <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-teal-500 to-teal-300" aria-hidden />
            <div className="space-y-3 pl-2">
              <h2 className="public-subheading text-teal-900">How to join a waitlist</h2>
              <ol className="list-decimal space-y-2 pl-5 text-sm text-gray-700 sm:text-base">
                <li>Start registration and create an account if you do not already have one.</li>
                <li>On the waitlists step, join one or more eligible league waitlists.</li>
                <li>Choose ADD (add as a first or second league) or REPLACE (give up another league).</li>
                <li>If you are already on a waitlist, confirm whether to auto-accept, auto-decline, or leave it.</li>
              </ol>
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
              <h2 className="public-subheading text-amber-950">How offers work</h2>
              <p className="text-sm text-amber-950/90 sm:text-base">
                After priority registration closes, returning members and sabbaticals are resolved first. Then permanent
                waitlist spots are offered, followed by temporary sabbatical-fill spots.
              </p>
              <div className="space-y-2 rounded-xl border border-amber-200/80 bg-white/80 px-4 py-3 text-sm text-amber-950">
                <p>
                  <span className="font-semibold">Permanent spot:</span> You join the league for good (subject to normal
                  return rules in later sessions).
                </p>
                <p>
                  <span className="font-semibold">Temporary sabbatical-fill:</span> You play for the session while
                  another member is on sabbatical. You stay on the waitlist for a permanent spot. Learn more about{' '}
                  <Link to="/explainers/sabbaticals" className="font-semibold text-amber-900 underline hover:text-amber-950">
                    sabbaticals
                  </Link>
                  .
                </p>
              </div>
            </div>
          </article>

          <article className="relative overflow-hidden rounded-2xl border border-sky-100 bg-gradient-to-r from-sky-50 via-white to-cyan-50 p-5 shadow-sm sm:p-6 lg:col-span-2">
            <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-sky-500 to-cyan-300" aria-hidden />
            <div className="space-y-2 pl-2">
              <h2 className="public-subheading text-sky-950">Declines and your position</h2>
              <p className="text-sm text-sky-950/90 sm:text-base">
                You have <span className="font-semibold text-sky-900">24 hours</span> to decline an offer. If you do not
                decline, it is treated as accepted. Your{' '}
                <span className="font-semibold text-sky-900">first decline</span> keeps your waitlist position; a{' '}
                <span className="font-semibold text-sky-900">second decline</span> moves you to the bottom. Declining a
                temporary spot counts the same as declining a permanent one.
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
