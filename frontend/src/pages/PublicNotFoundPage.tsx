import { Link } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout';
import SeoMeta from '../components/SeoMeta';

export type PublicNotFoundAction = {
  label: string;
  to: string;
};

export type PublicNotFoundPageProps = {
  title?: string;
  description?: string;
  seoTitle?: string;
  primaryAction?: PublicNotFoundAction;
  secondaryAction?: PublicNotFoundAction | null;
  showCode?: boolean;
};

const DEFAULT_TITLE = 'Page not found';
const DEFAULT_DESCRIPTION =
  "We couldn't find the page you're looking for. It may have moved, been removed, or the link might be outdated.";

export default function PublicNotFoundPage({
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  seoTitle = 'Page not found | Triangle Curling Club',
  primaryAction = { label: 'Back to home', to: '/' },
  secondaryAction = null,
  showCode = true,
}: PublicNotFoundPageProps) {
  return (
    <PublicLayout>
      <SeoMeta title={seoTitle} />
      <div className="public-container public-section">
        <section
          className="relative overflow-hidden rounded-3xl border border-teal-100 bg-gradient-to-br from-sky-50 via-white to-teal-50 px-6 py-14 shadow-sm sm:px-10 sm:py-20 lg:py-24"
          aria-labelledby="public-not-found-heading"
        >
          <div
            className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-teal-200/40 blur-3xl"
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute -left-24 bottom-0 h-52 w-52 rounded-full bg-sky-200/50 blur-3xl"
            aria-hidden="true"
          />

          <div className="relative mx-auto max-w-2xl text-center">
            {showCode ? (
              <p
                className="public-display text-7xl font-semibold leading-none tracking-tight text-primary-teal/25 sm:text-8xl"
                aria-hidden="true"
              >
                404
              </p>
            ) : null}

            <div className={showCode ? 'mt-2 space-y-4 sm:mt-4' : 'space-y-4'}>
              <h1
                id="public-not-found-heading"
                className="public-display text-3xl font-semibold tracking-tight text-gray-900 text-balance sm:text-4xl"
              >
                {title}
              </h1>
              <p className="public-body mx-auto max-w-xl text-balance">{description}</p>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                to={primaryAction.to}
                className="inline-flex min-h-[2.75rem] items-center justify-center rounded-full bg-primary-teal-solid px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary-teal/25 transition hover:bg-primary-teal-solid/90 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/50 focus-visible:ring-offset-2 motion-reduce:transition-none"
              >
                {primaryAction.label}
              </Link>
              {secondaryAction ? (
                <Link
                  to={secondaryAction.to}
                  className="inline-flex min-h-[2.75rem] items-center justify-center rounded-full border border-gray-300 bg-white px-6 py-2.5 text-sm font-semibold text-gray-800 transition hover:border-primary-teal/40 hover:text-primary-teal-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/50 focus-visible:ring-offset-2 motion-reduce:transition-none"
                >
                  {secondaryAction.label}
                </Link>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </PublicLayout>
  );
}
