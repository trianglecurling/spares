import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../utils/api';
import PublicLayout from '../components/PublicLayout';
import SeoMeta from '../components/SeoMeta';
import { useAuth } from '../contexts/AuthContext';

interface HomeData {
  siteConfig: {
    clubName: string | null;
    logoUrl: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    footerMarkdown: string | null;
  } | null;
  featuredArticles: Array<{
    id: number;
    title: string;
    slug: string;
    snippet: string;
    hasMore: boolean;
  }>;
  showcaseImages: Array<{
    id: number;
    url: string;
    caption: string | null;
  }>;
  upcomingBonspiels: Array<{
    id: string;
    title: string;
    start: string;
    end: string;
    allDay: boolean;
  }>;
}

const HOMEPAGE_COPY = {
  title: 'Curling in the Triangle',
  subtitle:
    'Triangle Curling Club is a dedicated, four-sheet curling facility offering leagues, bonspiels, public curling events, and daytime group events.',
};

function snippetPreview(text: string): string {
  const normalized = text.replace(/[#>*_`[\]()!-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (normalized.length <= 220) return normalized;
  return `${normalized.slice(0, 217)}...`;
}

export default function PublicHomePage() {
  const { member, token, isLoading } = useAuth();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [heroImageIndex, setHeroImageIndex] = useState(0);
  const [heroAutoScrollEnabled, setHeroAutoScrollEnabled] = useState(true);

  const heroImages = useMemo(() => {
    const showcase = data?.showcaseImages ?? [];
    if (showcase.length > 0) {
      return showcase.map((img) => ({
        src: img.url,
        caption: img.caption?.trim() || 'Triangle Curling Club',
      }));
    }
    return [
      { src: 'https://placehold.co/960x540/e6fffb/0f766e?text=Club+photo+placeholder+1', caption: 'Club photo placeholder 1' },
      { src: 'https://placehold.co/960x540/ecfeff/0369a1?text=Club+photo+placeholder+2', caption: 'Club photo placeholder 2' },
      { src: 'https://placehold.co/960x540/f0fdf4/15803d?text=Club+photo+placeholder+3', caption: 'Club photo placeholder 3' },
      { src: 'https://placehold.co/960x540/fdf4ff/a21caf?text=Club+photo+placeholder+4', caption: 'Club photo placeholder 4' },
    ];
  }, [data?.showcaseImages]);

  const sponsorPlaceholders = useMemo(
    () =>
      Array.from({ length: 20 }, (_, i) => ({
        id: i + 1,
        src: `https://placehold.co/180x96/f8fafc/94a3b8?text=Sponsor+${i + 1}`,
      })),
    []
  );

  useEffect(() => {
    api
      .get<HomeData>('/public/home')
      .then((res) => setData(res.data))
      .catch((err) => setError(err?.response?.data?.error || 'Failed to load'));
  }, []);

  useEffect(() => {
    if (heroImages.length <= 1 || !heroAutoScrollEnabled) return;
    const intervalId = window.setInterval(() => {
      setHeroImageIndex((prev) => (prev + 1) % heroImages.length);
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [heroAutoScrollEnabled, heroImages.length]);

  useEffect(() => {
    if (heroImageIndex >= heroImages.length) {
      setHeroImageIndex(0);
    }
  }, [heroImageIndex, heroImages.length]);

  const showPreviousHeroImage = (manual = false) => {
    if (manual) setHeroAutoScrollEnabled(false);
    setHeroImageIndex((prev) => (prev - 1 + heroImages.length) % heroImages.length);
  };

  const showNextHeroImage = (manual = false) => {
    if (manual) setHeroAutoScrollEnabled(false);
    setHeroImageIndex((prev) => (prev + 1) % heroImages.length);
  };

  const showHeroImageAt = (index: number) => {
    setHeroAutoScrollEnabled(false);
    setHeroImageIndex(index);
  };

  if (error) {
    return (
      <PublicLayout>
        <section className="public-section">
          <div className="public-container">
            <div className="public-card p-6 text-red-700">{error}</div>
          </div>
        </section>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <SeoMeta
        title="Triangle Curling Club | Curling in the Triangle"
        description="Discover curling in the Raleigh, Durham, and Chapel Hill area: beginner resources, group event info, upcoming bonspiels, and member information."
        canonicalPath="/"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'SportsClub',
          name: data?.siteConfig?.clubName || 'Triangle Curling Club',
          description:
            'Triangle Curling Club provides learn-to-curl experiences, leagues, bonspiels, and group events in the Raleigh, Durham, and Chapel Hill area of North Carolina.',
          areaServed: ['Raleigh, NC', 'Durham, NC', 'Chapel Hill, NC'],
          email: data?.siteConfig?.contactEmail || undefined,
          telephone: data?.siteConfig?.contactPhone || undefined,
          url: typeof window !== 'undefined' ? `${window.location.origin}/` : undefined,
        }}
      />
      <div className="public-container">
        {!data ? (
          <section className="public-section">
            <div className="public-card p-6 text-gray-600">Loading homepage...</div>
          </section>
        ) : (
          <>
            <section className="public-section pb-8 sm:pb-12">
              <div className="rounded-3xl border border-teal-100 bg-gradient-to-br from-teal-50 via-sky-50 to-white p-5 sm:p-8 lg:p-10 shadow-sm">
                <div className="grid gap-8 lg:grid-cols-[1.05fr_1fr] lg:items-start">
                  <div className="space-y-6">
                    <p className="inline-flex items-center rounded-full bg-primary-teal/10 px-3 py-1 text-sm font-medium text-primary-teal">
                      Raleigh, Durham, and Chapel Hill area of North Carolina
                    </p>
                    <h1 className="public-heading text-balance">{HOMEPAGE_COPY.title}</h1>
                    <p className="public-body text-lg">{HOMEPAGE_COPY.subtitle}</p>
                    <div className="flex flex-wrap gap-3">
                      <Link
                        to="/articles/try-curling"
                        className="rounded-md bg-primary-teal px-4 py-2 text-sm font-medium text-white hover:bg-primary-teal/90"
                      >
                        Learn about curling
                      </Link>
                      <Link
                        to="/articles/team-building-group-events"
                        className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
                      >
                        Plan a group event
                      </Link>
                      <a
                        href="#upcoming-bonspiels"
                        className="rounded-md border border-sky-200 bg-white px-4 py-2 text-sm font-medium text-sky-700 hover:bg-sky-50"
                      >
                        Upcoming bonspiels
                      </a>
                      {!isLoading && !token && !member && (
                        <Link
                          to="/login"
                          className="rounded-md border border-teal-200 bg-white px-4 py-2 text-sm font-medium text-teal-700 hover:bg-teal-50"
                        >
                          Member login
                        </Link>
                      )}
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="relative overflow-hidden rounded-2xl border border-white/60 bg-white shadow-md">
                      <button
                        type="button"
                        className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/70 bg-black/30 p-2 text-white backdrop-blur hover:bg-black/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                        aria-label="Show previous image"
                        onClick={() => showPreviousHeroImage(true)}
                      >
                        &#8592;
                      </button>
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/70 bg-black/30 p-2 text-white backdrop-blur hover:bg-black/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                        aria-label="Show next image"
                        onClick={() => showNextHeroImage(true)}
                      >
                        &#8594;
                      </button>
                      <div
                        className="flex transition-transform duration-300 ease-out motion-reduce:transition-none"
                        style={{ transform: `translateX(-${heroImageIndex * 100}%)` }}
                      >
                        {heroImages.map((image, index) => (
                          <div key={`${image.src}-${index}`} className="relative w-full shrink-0">
                            <img
                              src={image.src}
                              alt={image.caption || 'Triangle Curling Club'}
                              className="aspect-[16/10] w-full object-cover"
                            />
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent p-3 text-sm text-white">
                              {image.caption || 'Triangle Curling Club'}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex flex-wrap gap-2">
                        {heroImages.slice(0, 6).map((image, index) => (
                          <button
                            key={`${image.src}-${index}`}
                            type="button"
                            className={`h-2.5 w-7 rounded-full transition-colors motion-reduce:transition-none ${index === heroImageIndex ? 'bg-primary-teal' : 'bg-gray-300 hover:bg-gray-400'}`}
                            aria-label={`Show image ${index + 1}`}
                            onClick={() => showHeroImageAt(index)}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="public-section pt-2">
              <h2 className="public-subheading">Latest updates</h2>
              {data.featuredArticles.length === 0 ? (
                <div className="public-card mt-4 p-5 text-gray-600">No featured resources are available yet. Please check back soon.</div>
              ) : (
                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {data.featuredArticles.map((article) => (
                    <article key={article.id} className="public-card p-5 bg-gradient-to-b from-white to-sky-50/30">
                      <h3 className="text-lg font-semibold text-gray-900 line-clamp-2">
                        <Link to={`/articles/${article.slug}`} className="hover:text-primary-teal">
                          {article.title}
                        </Link>
                      </h3>
                      {article.snippet && (
                        <p className="mt-2 text-sm text-gray-600 line-clamp-4">{snippetPreview(article.snippet)}</p>
                      )}
                      {article.hasMore && (
                        <Link
                          to={`/articles/${article.slug}`}
                          className="mt-3 inline-block text-sm font-medium text-primary-teal hover:underline"
                        >
                          Read more
                        </Link>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section id="upcoming-bonspiels" className="public-section pt-2">
              <div className="flex items-center justify-between gap-3">
                <h2 className="public-subheading">Upcoming bonspiels</h2>
                <Link
                  to="/calendar/public"
                  className="text-sm font-medium text-primary-teal hover:underline whitespace-nowrap"
                >
                  Full calendar
                </Link>
              </div>
              {data.upcomingBonspiels.length === 0 ? (
                <div className="public-card mt-4 p-5 text-gray-600">No upcoming bonspiels are listed right now.</div>
              ) : (
                <ul className="mt-4 space-y-3">
                  {data.upcomingBonspiels.map((ev) => (
                    <li key={ev.id} className="public-card p-4 sm:p-5">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm font-medium text-gray-500">
                          {new Date(ev.start).toLocaleDateString(undefined, {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                            year: ev.allDay ? 'numeric' : undefined,
                            ...(ev.allDay ? {} : { hour: 'numeric', minute: '2-digit' }),
                          })}
                        </p>
                        <p className="text-base font-semibold text-gray-900">{ev.title}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="public-section pt-0">
              <div className="rounded-3xl border border-amber-100 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6 sm:p-8">
                <h2 className="text-xl font-semibold text-gray-900">Our sponsors</h2>
                <p className="mt-2 text-sm text-gray-600">
                  Sponsor logos appear here. Replace these placeholders with current sponsor assets from your content workflow.
                </p>
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {sponsorPlaceholders.map((sponsor) => (
                    <div key={sponsor.id} className="public-card flex items-center justify-center p-2">
                      <img src={sponsor.src} alt={`Sponsor ${sponsor.id}`} className="h-12 w-full object-contain" loading="lazy" />
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </PublicLayout>
  );
}
