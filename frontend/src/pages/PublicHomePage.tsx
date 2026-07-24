import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  HiArrowRight,
  HiChevronLeft,
  HiChevronRight,
  HiOutlineEnvelope,
  HiOutlineIdentification,
  HiOutlineMapPin,
  HiOutlineMegaphone,
  HiOutlineSparkles,
  HiOutlineTrophy,
  HiOutlineUserGroup,
} from 'react-icons/hi2';
import api from '../utils/api';
import { setCachedDefaultPaymentProvider } from '../utils/paymentProcessorCopy';
import {
  PUBLIC_BOOTSTRAP_INVALIDATED_EVENT,
  publicBootstrapFetchConfig,
} from '../utils/publicBootstrapClient';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import SeoMeta from '../components/SeoMeta';
import { ArticleMarkdown } from '../components/ArticleMarkdown';
import { useAuth } from '../contexts/AuthContext';
import { syncSiteBrandingFromBootstrap } from '../hooks/useSiteBranding';

interface HomeData {
  siteConfig: {
    clubName: string | null;
    logoUrl: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    physicalAddressLine1: string | null;
    physicalAddressLine2: string | null;
    mailingAddressLine1: string | null;
    mailingAddressLine2: string | null;
    footerMarkdown: string | null;
    heroBadge?: string | null;
    heroTitle?: string | null;
    heroSubtitle?: string | null;
    /** Already filtered server-side: only present when set and unexpired. */
    announcementMarkdown?: string | null;
    disableSms?: boolean;
    fiscalYearStartMmdd?: string;
  } | null;
  featuredArticles: Array<{
    id: number;
    title: string;
    slug: string;
    snippet: string;
    hasMore: boolean;
    /** When set, this featured item is an event detail article; link to the event page. */
    eventSlug?: string | null;
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
    eventSlug?: string | null;
  }>;
  currentSponsorships: Array<{
    sponsorshipId: number;
    sponsorId: number;
    sponsorName: string;
    sponsorWebsiteUrl: string;
    sponsorLogoUrl: string | null;
    levelSortOrder: number;
  }>;
}

type SiteConfig = NonNullable<HomeData['siteConfig']>;

interface MenuItemNode {
  id: number;
  label: string;
  linkType: 'internal' | 'external' | null;
  url: string | null;
  openInNewTab: boolean;
  children: MenuItemNode[];
}

interface PublicHomeBootstrapResponse {
  siteConfig: SiteConfig | null;
  navbarMenu: MenuItemNode[];
  home: HomeData | null;
  defaultPaymentProvider?: 'stripe' | 'paypal' | 'square';
  isPreviewDatabase?: boolean;
}

const HOMEPAGE_COPY = {
  badge: 'Raleigh, Durham, and Chapel Hill area of North Carolina',
  title: 'Curling in the Triangle',
  subtitle:
    'Triangle Curling Club is a dedicated, four-sheet curling facility offering leagues, bonspiels, public curling events, and daytime group events.',
};

/** Curling house (target rings) ornament; colored via currentColor. */
function HouseRings({ className }: { className?: string }) {
  const ringStroke = {
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeOpacity: 0.5,
  };
  const lightBand = {
    fill: 'currentColor',
    fillOpacity: 0.07,
  };

  /** Filled band between two circle radii (even-odd donut). */
  const annulus = (outerR: number, innerR: number) =>
    `M 100 ${100 - outerR} a ${outerR} ${outerR} 0 1 0 0 ${outerR * 2} a ${outerR} ${outerR} 0 1 0 0 ${-outerR * 2} ` +
    `M 100 ${100 - innerR} a ${innerR} ${innerR} 0 1 1 0 ${innerR * 2} a ${innerR} ${innerR} 0 1 1 0 ${-innerR * 2} Z`;

  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden="true" focusable="false">
      {/* Inner → outer fills: transparent, light, transparent, light */}
      <path fillRule="evenodd" d={annulus(97, 66)} {...lightBand} />
      <path fillRule="evenodd" d={annulus(40, 13)} {...lightBand} />
      <circle cx="100" cy="100" r="97" {...ringStroke} />
      <circle cx="100" cy="100" r="66" {...ringStroke} />
      <circle cx="100" cy="100" r="40" {...ringStroke} />
      <circle cx="100" cy="100" r="13" {...ringStroke} />
    </svg>
  );
}

function formatBonspielDates(ev: { start: string; end: string; allDay: boolean }): {
  monthLabel: string;
  dayLabel: string;
  fullLabel: string;
} {
  const start = new Date(ev.start);
  const end = new Date(ev.end);
  const sameDay = start.toDateString() === end.toDateString();
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();

  const month = (d: Date) => d.toLocaleDateString(undefined, { month: 'short' });
  const monthDay = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const year = start.getFullYear() === end.getFullYear() ? `${start.getFullYear()}` : null;

  if (sameDay) {
    return {
      monthLabel: month(start),
      dayLabel: `${start.getDate()}`,
      fullLabel: start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
    };
  }
  if (sameMonth) {
    return {
      monthLabel: month(start),
      dayLabel: `${start.getDate()}\u2013${end.getDate()}`,
      fullLabel: `${monthDay(start)}\u2013${end.getDate()}, ${start.getFullYear()}`,
    };
  }
  return {
    monthLabel: month(start),
    dayLabel: `${start.getDate()}`,
    fullLabel: year
      ? `${monthDay(start)} \u2013 ${monthDay(end)}, ${year}`
      : `${monthDay(start)}, ${start.getFullYear()} \u2013 ${monthDay(end)}, ${end.getFullYear()}`,
  };
}

function HeroCarousel({ images }: { images: Array<{ src: string; caption: string }> }) {
  const [index, setIndex] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const [hovering, setHovering] = useState(false);
  const touchStartXRef = useRef<number | null>(null);
  const prefersReducedMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );

  useEffect(() => {
    if (index >= images.length) setIndex(0);
  }, [index, images.length]);

  useEffect(() => {
    if (images.length <= 1 || !autoScroll || hovering || prefersReducedMotion) return;
    const intervalId = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % images.length);
    }, 6000);
    return () => window.clearInterval(intervalId);
  }, [autoScroll, hovering, images.length, prefersReducedMotion]);

  const goTo = (next: number, manual = false) => {
    if (manual) setAutoScroll(false);
    setIndex(((next % images.length) + images.length) % images.length);
  };

  return (
    <div
      className="group relative"
      role="group"
      aria-roledescription="carousel"
      aria-label="Club photos"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onTouchStart={(e) => {
        touchStartXRef.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const startX = touchStartXRef.current;
        touchStartXRef.current = null;
        if (startX == null) return;
        const delta = (e.changedTouches[0]?.clientX ?? startX) - startX;
        if (Math.abs(delta) < 40) return;
        goTo(delta < 0 ? index + 1 : index - 1, true);
      }}
    >
      <div className="relative aspect-[4/3] sm:aspect-[16/10] overflow-hidden rounded-3xl bg-teal-950/5 shadow-xl shadow-teal-900/10 ring-1 ring-black/5">
        {images.map((image, i) => (
          <div
            key={`${image.src}-${i}`}
            className={`absolute inset-0 transition-opacity duration-700 ease-out motion-reduce:transition-none ${
              i === index ? 'opacity-100' : 'opacity-0'
            }`}
            aria-hidden={i !== index}
          >
            <img
              src={image.src}
              alt={image.caption}
              className="h-full w-full object-cover"
              loading={i === 0 ? 'eager' : 'lazy'}
              draggable={false}
            />
          </div>
        ))}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/60 via-black/25 to-transparent p-4 pt-12">
          <p className="min-w-0 truncate text-sm font-medium text-white drop-shadow">{images[index]?.caption}</p>
          {images.length > 1 && (
            <div className="pointer-events-auto flex shrink-0 items-center gap-1.5" role="tablist" aria-label="Choose photo">
              {images.slice(0, 8).map((image, i) => (
                <button
                  key={`${image.src}-dot-${i}`}
                  type="button"
                  role="tab"
                  className="flex h-8 w-5 items-center justify-center"
                  aria-label={`Show photo ${i + 1} of ${images.length}`}
                  aria-selected={i === index}
                  onClick={() => goTo(i, true)}
                >
                  <span
                    className={`block h-2 rounded-full transition-all motion-reduce:transition-none ${
                      i === index ? 'w-5 bg-white' : 'w-2 bg-white/55 hover:bg-white/80'
                    }`}
                    aria-hidden
                  />
                </button>
              ))}
            </div>
          )}
        </div>
        {images.length > 1 && (
          <>
            <button
              type="button"
              className="absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur transition-opacity hover:bg-black/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/90 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 motion-reduce:transition-none"
              aria-label="Show previous photo"
              onClick={() => goTo(index - 1, true)}
            >
              <HiChevronLeft className="h-6 w-6" aria-hidden />
            </button>
            <button
              type="button"
              className="absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur transition-opacity hover:bg-black/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/90 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 motion-reduce:transition-none"
              aria-label="Show next photo"
              onClick={() => goTo(index + 1, true)}
            >
              <HiChevronRight className="h-6 w-6" aria-hidden />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  id,
  action,
}: {
  eyebrow: string;
  title: string;
  id?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div>
        <p className="public-eyebrow">{eyebrow}</p>
        <h2 id={id} className="public-display mt-1 text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}

export default function PublicHomePage() {
  const { isLoading, isLikelyAuthenticated } = useAuth();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDelayedLoading, setShowDelayedLoading] = useState(false);
  const [layoutSiteConfig, setLayoutSiteConfig] = useState<SiteConfig | null | undefined>(undefined);
  const [layoutMenuItems, setLayoutMenuItems] = useState<MenuItemNode[] | undefined>(undefined);
  const [deferLayoutBootstrapLoad, setDeferLayoutBootstrapLoad] = useState(true);

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

  const displayedSponsorships = useMemo(() => {
    const sorted = [...(data?.currentSponsorships ?? [])]
      .filter((s) => Boolean(s.sponsorLogoUrl))
      .sort((a, b) => a.levelSortOrder - b.levelSortOrder || Math.random() - 0.5);
    const seenLogos = new Set<string>();
    return sorted.filter((s) => {
      const logoKey = s.sponsorLogoUrl || `sponsor-${s.sponsorId}`;
      if (seenLogos.has(logoKey)) return false;
      seenLogos.add(logoKey);
      return true;
    });
  }, [data?.currentSponsorships]);

  useEffect(() => {
    const loadHomeBootstrap = () => {
      api
        .get<PublicHomeBootstrapResponse>('/public/bootstrap', {
          params: { includeHome: 'true' },
          ...publicBootstrapFetchConfig,
        })
        .then((res) => {
          setCachedDefaultPaymentProvider(res.data?.defaultPaymentProvider);
          syncSiteBrandingFromBootstrap(res.data);
          setLayoutSiteConfig(res.data?.siteConfig ?? null);
          setLayoutMenuItems(Array.isArray(res.data?.navbarMenu) ? res.data.navbarMenu : []);
          if (res.data?.home) {
            setData(res.data.home);
            return;
          }
          setError('Failed to load');
        })
        .catch((err) => {
          setDeferLayoutBootstrapLoad(false);
          setError(err?.response?.data?.error || 'Failed to load');
        });
    };

    loadHomeBootstrap();

    const onInvalidated = () => {
      loadHomeBootstrap();
    };
    window.addEventListener(PUBLIC_BOOTSTRAP_INVALIDATED_EVENT, onInvalidated);
    return () => window.removeEventListener(PUBLIC_BOOTSTRAP_INVALIDATED_EVENT, onInvalidated);
  }, []);

  useEffect(() => {
    if (data || error) {
      setShowDelayedLoading(false);
      return;
    }
    const timerId = window.setTimeout(() => {
      setShowDelayedLoading(true);
    }, 1000);
    return () => window.clearTimeout(timerId);
  }, [data, error]);

  const isMemberSignedIn = !isLoading && isLikelyAuthenticated;

  const pathways = [
    {
      key: 'new',
      eyebrow: 'New to curling?',
      title: 'Try curling',
      description: 'No experience needed. Learn-to-curl sessions and public events are the perfect first slide onto the ice.',
      cta: 'Learn how to start',
      to: '/articles/try-curling',
      Icon: HiOutlineSparkles,
    },
    {
      key: 'bonspiel',
      eyebrow: 'Visiting curlers',
      title: 'Bonspiels',
      description: 'Curlers from every club are welcome at our tournaments. See what is coming up and register your team.',
      cta: 'Upcoming bonspiels',
      href: '#upcoming-bonspiels',
      Icon: HiOutlineTrophy,
    },
    {
      key: 'group',
      eyebrow: 'Groups and teams',
      title: 'Group events',
      description: 'Team building, parties, and daytime outings on real curling ice, guided by our volunteer instructors.',
      cta: 'Plan a group event',
      to: '/articles/team-building-group-events',
      Icon: HiOutlineUserGroup,
    },
    {
      key: 'member',
      eyebrow: 'Club members',
      title: 'Member area',
      description: 'League schedules, ice booking, spare requests, registration, and everything else for club life.',
      cta: isMemberSignedIn ? 'Go to your dashboard' : 'Member login',
      to: isMemberSignedIn ? '/dashboard' : '/login',
      Icon: HiOutlineIdentification,
    },
  ];

  if (error) {
    return (
      <PublicLayout
        initialSiteConfig={layoutSiteConfig}
        initialMenuItems={layoutMenuItems}
        deferPublicBootstrapLoad={deferLayoutBootstrapLoad}
      >
        <section className="public-section">
          <div className="public-container">
            <div className="public-content">
              <PublicStateCard
                title="Unable to load homepage"
                description={error}
                tone="error"
              />
            </div>
          </div>
        </section>
      </PublicLayout>
    );
  }

  const heroBadge = data?.siteConfig?.heroBadge?.trim() || HOMEPAGE_COPY.badge;
  const heroTitle = data?.siteConfig?.heroTitle?.trim() || HOMEPAGE_COPY.title;
  const heroSubtitle = data?.siteConfig?.heroSubtitle?.trim() || HOMEPAGE_COPY.subtitle;
  const announcementMarkdown = data?.siteConfig?.announcementMarkdown?.trim() || null;
  return (
    <PublicLayout
      initialSiteConfig={layoutSiteConfig}
      initialMenuItems={layoutMenuItems}
      deferPublicBootstrapLoad={deferLayoutBootstrapLoad}
    >
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
      {!data ? (
        showDelayedLoading ? (
          <section className="public-section">
            <div className="public-container">
              <div className="public-content">
                <PublicStateCard
                  title="Loading homepage..."
                  description="Pulling in the latest public content, featured updates, and club highlights."
                />
              </div>
            </div>
          </section>
        ) : null
      ) : (
        <>
          {announcementMarkdown && (
            <div className="border-b border-amber-200/80 bg-amber-50">
              <div className="public-container flex items-start gap-3 py-3">
                <HiOutlineMegaphone className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
                <ArticleMarkdown
                  markdown={announcementMarkdown}
                  className="markdown-content max-w-none flex-1 !text-sm text-amber-900 [&_a]:font-medium [&_a]:text-amber-900 [&_a]:underline"
                />
              </div>
            </div>
          )}

          <section className="public-home-hero-bg relative overflow-hidden">
            <HouseRings className="pointer-events-none absolute -right-32 -top-36 h-[30rem] w-[30rem] text-primary-teal-link opacity-30 max-lg:hidden" />
            <HouseRings className="pointer-events-none absolute -bottom-44 -left-36 h-[26rem] w-[26rem] text-primary-teal-link opacity-30" />
            <div className="public-container relative py-10 sm:py-14 lg:py-16">
              <div className="grid items-start gap-10 lg:grid-cols-[1.05fr_1fr]">
                <div className="max-w-xl">
                  <p className="inline-flex items-center gap-2 rounded-full border border-primary-teal/25 bg-white/80 px-3.5 py-1.5 text-sm font-medium text-primary-teal-link shadow-sm backdrop-blur">
                    <HiOutlineMapPin className="h-4 w-4 shrink-0" aria-hidden />
                    {heroBadge}
                  </p>
                  <h1 className="public-display mt-5 text-4xl font-semibold leading-[1.05] tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
                    {heroTitle}
                  </h1>
                  <p className="mt-4 text-sm text-gray-500">
                    A 501(c)(3) nonprofit, 100% volunteer-run since day one.
                  </p>
                  <div className="mt-8" aria-labelledby="home-pathways-heading">
                    <p id="home-pathways-heading" className="public-eyebrow">
                      Start here
                    </p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {pathways.map(({ key, eyebrow, title, cta, to, href, Icon }) => {
                        const cardInner = (
                          <>
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-teal/10 text-primary-teal-link transition group-hover:bg-primary-teal-solid group-hover:text-white motion-reduce:transition-none">
                              <Icon className="h-6 w-6" aria-hidden />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-gray-500">
                                {eyebrow}
                              </span>
                              <span className="public-display block text-base font-semibold text-gray-900">
                                {title}
                              </span>
                              <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-primary-teal-link">
                                {cta}
                                <HiArrowRight
                                  className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                                  aria-hidden
                                />
                              </span>
                            </span>
                          </>
                        );
                        const cardClass =
                          'group flex items-center gap-3.5 rounded-2xl border border-gray-200 bg-white/80 p-3.5 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:border-primary-teal/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/50 motion-reduce:transition-none motion-reduce:hover:translate-y-0';
                        return href ? (
                          <a key={key} href={href} className={cardClass}>
                            {cardInner}
                          </a>
                        ) : (
                          <Link key={key} to={to!} className={cardClass}>
                            {cardInner}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div>
                  <HeroCarousel images={heroImages} />
                  <p className="public-body mt-6 text-base sm:text-lg">{heroSubtitle}</p>
                </div>
              </div>
            </div>
          </section>

          <section className="public-home-band" aria-labelledby="home-updates-heading">
            <div className="public-container py-12 sm:py-16">
              <SectionHeading eyebrow="Club news" title="Latest updates" id="home-updates-heading" />
              {data.featuredArticles.length === 0 ? (
                <div className="mt-6">
                  <PublicStateCard
                    title="No featured resources yet."
                    description="Check back soon for club updates, guides, and highlighted articles."
                  />
                </div>
              ) : (
                <ul className="mt-6 space-y-3">
                  {data.featuredArticles.map((article) => {
                    const featuredHref = article.eventSlug
                      ? `/events/${article.eventSlug}`
                      : `/articles/${article.slug}`;
                    return (
                      <li key={article.id}>
                        <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
                          <h3 className="public-display text-lg font-semibold text-gray-900">
                            <Link
                              to={featuredHref}
                              className="hover:text-primary-teal-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/50 rounded-sm"
                            >
                              {article.title}
                            </Link>
                          </h3>
                          {article.snippet ? (
                            <div className="mt-3">
                              <ArticleMarkdown markdown={article.snippet} />
                            </div>
                          ) : null}
                          {article.hasMore ? (
                            <Link
                              to={featuredHref}
                              className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary-teal-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/50 rounded-sm"
                            >
                              Read more
                              <HiArrowRight className="h-4 w-4" aria-hidden />
                            </Link>
                          ) : null}
                        </article>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          <section id="upcoming-bonspiels" className="scroll-mt-24" aria-labelledby="home-bonspiels-heading">
            <div className="public-container py-12 sm:py-16">
              <SectionHeading
                eyebrow="Come to our house"
                title="Upcoming bonspiels"
                id="home-bonspiels-heading"
                action={
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <Link
                      to="/events"
                      className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-semibold text-primary-teal-link hover:underline"
                    >
                      All events
                      <HiArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                    <Link
                      to="/calendar/public"
                      className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-semibold text-primary-teal-link hover:underline"
                    >
                      Full calendar
                      <HiArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                  </div>
                }
              />
              <p className="public-body mt-2 max-w-2xl">
                Curlers from other clubs are always welcome at our four-sheet facility. Tap a bonspiel for details and
                registration.
              </p>
              {data.upcomingBonspiels.length === 0 ? (
                <div className="public-card mt-6 p-6 text-gray-600">
                  No upcoming bonspiels are listed right now. Check the{' '}
                  <Link to="/calendar/public" className="font-medium text-primary-teal-link hover:underline">
                    club calendar
                  </Link>{' '}
                  for everything else happening on the ice.
                </div>
              ) : (
                <ul className="mt-6 space-y-3">
                  {data.upcomingBonspiels.map((ev) => {
                    const dates = formatBonspielDates(ev);
                    const rowInner = (
                      <>
                        <div
                          className="flex w-20 shrink-0 flex-col items-center justify-center self-stretch rounded-xl bg-primary-teal/10 px-2 py-3 text-primary-teal-on-tint"
                          aria-hidden
                        >
                          <span className="text-xs font-bold uppercase tracking-widest">{dates.monthLabel}</span>
                          <span className="public-display text-xl font-semibold leading-tight">{dates.dayLabel}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="public-display truncate text-lg font-semibold text-gray-900">{ev.title}</p>
                          <p className="mt-0.5 text-sm text-gray-500">{dates.fullLabel}</p>
                        </div>
                      </>
                    );
                    return (
                      <li key={ev.id}>
                        {ev.eventSlug ? (
                          <Link
                            to={`/events/${ev.eventSlug}`}
                            className="group flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-primary-teal/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/50 sm:p-5 motion-reduce:transition-none"
                          >
                            {rowInner}
                          </Link>
                        ) : (
                          <div className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
                            {rowInner}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          <section aria-labelledby="home-visit-heading">
            <div className="public-container pb-12 sm:pb-16">
              <div className="relative overflow-hidden rounded-3xl bg-[#0b3d3f] text-white shadow-xl">
                <HouseRings className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 text-white opacity-20" />
                <div className="relative grid gap-10 p-7 sm:p-10 md:grid-cols-2 lg:p-12">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-200">
                      A community nonprofit
                    </p>
                    <h2 id="home-visit-heading" className="public-display mt-2 text-2xl font-semibold sm:text-3xl">
                      Built and run by volunteers
                    </h2>
                    <p className="mt-4 leading-relaxed text-teal-50/90">
                      Triangle Curling Club is a 501(c)(3) nonprofit. Our members built this facility, maintain the
                      ice, teach every class, and run every league and event. Everything you spend here goes back into
                      growing curling in the Triangle.
                    </p>
                    <Link
                      to="/articles/sponsorship"
                      className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-teal-200 hover:text-white hover:underline"
                    >
                      Become a sponsor
                      <HiArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                  </div>
                  <div className="md:border-l md:border-white/15 md:pl-10">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-200">Stay connected</p>
                    <ul className="mt-4 space-y-4 text-sm leading-relaxed">
                      <li className="flex items-start gap-3">
                        <HiOutlineMapPin className="mt-0.5 h-5 w-5 shrink-0 text-teal-200" aria-hidden />
                        <Link to="/articles/visit-us" className="font-semibold hover:underline">
                          Visit Triangle Curling
                        </Link>
                      </li>
                      <li className="flex items-start gap-3">
                        <HiOutlineEnvelope className="mt-0.5 h-5 w-5 shrink-0 text-teal-200" aria-hidden />
                        <Link to="/mailing-list/membership" className="font-semibold hover:underline">
                          Join our mailing list
                        </Link>
                      </li>
                    </ul>
                    <Link
                      to="/contact"
                      className="mt-5 inline-flex min-h-[2.75rem] items-center gap-2 rounded-full border border-white/30 bg-white/10 px-5 py-2 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 motion-reduce:transition-none"
                    >
                      Contact the club
                      <HiArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {displayedSponsorships.length > 0 && (
            <section aria-labelledby="home-sponsors-heading">
              <div className="public-container pb-14 sm:pb-20">
                <SectionHeading
                  eyebrow="Thank you"
                  title="Our sponsors"
                  id="home-sponsors-heading"
                  action={
                    <Link
                      to="/articles/sponsorship"
                      className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-semibold text-primary-teal-link hover:underline"
                    >
                      Become a sponsor
                      <HiArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                  }
                />
                <p className="public-body mt-2 max-w-2xl">
                  Triangle Curling extends its sincere gratitude to the local businesses that keep our nonprofit club
                  on the ice.
                </p>
                <ul className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {displayedSponsorships.map((sponsorship) => (
                    <li key={sponsorship.sponsorshipId}>
                      <a
                        href={sponsorship.sponsorWebsiteUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={sponsorship.sponsorName}
                        className="flex h-28 items-center justify-center rounded-2xl border border-gray-200 bg-white p-4 transition hover:-translate-y-0.5 hover:border-primary-teal/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/50 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                      >
                        <img
                          src={sponsorship.sponsorLogoUrl || ''}
                          alt={sponsorship.sponsorName}
                          className="max-h-full max-w-full object-contain"
                          loading="lazy"
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
        </>
      )}
    </PublicLayout>
  );
}
