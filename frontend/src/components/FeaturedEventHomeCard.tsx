import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HiArrowRight } from 'react-icons/hi2';
import { ArticleMarkdown } from './ArticleMarkdown';
import PublicEventInfoPanel, {
  isPublicRegistrationAvailable,
  type PublicEventInfoEvent,
} from './PublicEventInfoPanel';
import { getEarliestStartMs, isLiveScoresWindowOpen } from '../utils/fiscalSeason';

export type FeaturedHomeEvent = {
  id: number;
  title: string;
  slug: string;
  snippet: string;
  hasMore: boolean;
  timespans: Array<{ id: number; start_dt: string; end_dt: string; sort_order: number }>;
  locations: Array<{ location_type: string }>;
  feeMinor: number;
  memberFeeMinor: number | null;
  currency: string;
  registrationStart: string | null;
  registrationCutoff: string | null;
  registrationFull: boolean;
  showTeams: boolean;
  showDraw: boolean;
  drawHasRecordedScores: boolean;
};

const HOME_LINK_CLASS =
  'inline-flex items-center text-sm font-semibold text-primary-teal-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/50 rounded-sm';

export default function FeaturedEventHomeCard({ event }: { event: FeaturedHomeEvent }) {
  const [scoresClock, setScoresClock] = useState(0);
  const [registrationClock, setRegistrationClock] = useState(0);
  const nowMs = Date.now();
  const showLiveScores =
    event.showDraw &&
    (isLiveScoresWindowOpen(event.timespans, nowMs) || event.drawHasRecordedScores);
  const registrationEvent: PublicEventInfoEvent = {
    slug: event.slug,
    timespans: event.timespans,
    locations: event.locations,
    feeMinor: event.feeMinor,
    memberFeeMinor: event.memberFeeMinor,
    currency: event.currency,
    registrationStart: event.registrationStart,
    registrationCutoff: event.registrationCutoff,
    capacity: null,
    openSpots: event.registrationFull ? 0 : null,
  };
  const showRegistration = isPublicRegistrationAvailable(registrationEvent, nowMs);
  const sectionLinks = [
    ...(event.showTeams ? [{ key: 'teams', label: 'Teams', tab: 'teams' as const }] : []),
    ...(event.showDraw ? [{ key: 'draw', label: 'Draw', tab: 'draw' as const }] : []),
    ...(showLiveScores ? [{ key: 'scores', label: 'Live scores', tab: 'scores' as const }] : []),
  ];
  const href = `/events/${event.slug}`;
  const hasCopy = Boolean(event.snippet) || event.hasMore;

  useEffect(() => {
    if (!event.showDraw || showLiveScores) return;
    const startMs = getEarliestStartMs(event.timespans);
    if (!Number.isFinite(startMs)) return;
    const openAt = startMs - 24 * 60 * 60 * 1000;
    const remaining = openAt - Date.now();
    if (remaining <= 0) return;
    const delay = Math.min(remaining, 2_147_483_647);
    const id = window.setTimeout(() => setScoresClock((value) => value + 1), delay);
    return () => window.clearTimeout(id);
  }, [event.showDraw, event.timespans, scoresClock, showLiveScores]);

  useEffect(() => {
    if (showRegistration || !event.registrationStart) return;
    const startMs = new Date(event.registrationStart).getTime();
    if (!Number.isFinite(startMs)) return;
    const remaining = startMs - Date.now();
    if (remaining <= 0) return;
    const delay = Math.min(remaining, 2_147_483_647);
    const id = window.setTimeout(() => setRegistrationClock((value) => value + 1), delay);
    return () => window.clearTimeout(id);
  }, [event.registrationStart, registrationClock, showRegistration]);

  return (
    <article className="py-5">
      <h3 className="public-display text-lg font-semibold text-gray-900">
        <Link
          to={href}
          className="hover:text-primary-teal-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/50 rounded-sm"
        >
          {event.title}
        </Link>
      </h3>

      {sectionLinks.length > 0 ? (
        <nav className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1" aria-label={`${event.title} sections`}>
          {sectionLinks.map((link) => (
            <Link key={link.key} to={`${href}?tab=${link.tab}`} className={HOME_LINK_CLASS}>
              {link.label}
            </Link>
          ))}
        </nav>
      ) : null}

      {hasCopy || showRegistration ? (
        <div
          className={`mt-3 flex flex-col gap-6 lg:items-start ${
            showRegistration && hasCopy ? 'lg:grid lg:grid-cols-12 lg:gap-x-10' : ''
          }`}
        >
          {hasCopy ? (
            <div className={showRegistration ? 'lg:col-span-8' : undefined}>
              {event.snippet ? <ArticleMarkdown markdown={event.snippet} /> : null}
              {event.hasMore ? (
                <Link to={href} className={`mt-4 gap-1.5 ${HOME_LINK_CLASS}`}>
                  Read more
                  <HiArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              ) : null}
            </div>
          ) : null}
          {showRegistration ? (
            <div className={hasCopy ? 'lg:col-span-4' : 'lg:max-w-md'}>
              <PublicEventInfoPanel variant="featured" serverOffsetMs={0} event={registrationEvent} />
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
