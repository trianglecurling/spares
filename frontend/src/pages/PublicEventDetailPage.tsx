import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import {
  HiCalendarDays,
  HiCurrencyDollar,
  HiMapPin,
  HiUserGroup,
} from 'react-icons/hi2';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import PageTabs from '../components/PageTabs';
import SeoMeta from '../components/SeoMeta';
import api from '../utils/api';
import {
  formatPositionCell,
  formatTeamDisplayName,
  foursTableLegendText,
  slotLabel,
  tableSlotsForFormat,
  type TournamentFormat,
} from '../utils/tournamentDisplay';

interface EventDetail {
  id: number;
  title: string;
  slug: string;
  articleId: number | null;
  imageFileId: number | null;
  visibility: string;
  published: number;
  calendarTypeId?: string;
  tournamentTeamsPublished?: number;
  tournamentDrawPublished?: number;
  capacity: number | null;
  feeMinor: number;
  memberFeeMinor?: number | null;
  currency: string;
  registrationStart: string | null;
  registrationCutoff: string | null;
  cancellationCutoff: string | null;
  allowGroupRegistration: number;
  maxGroupSize: number | null;
  enableWaitlist: number;
  termsArticleId: number | null;
  timespans: Array<{ id: number; start_dt: string; end_dt: string; sort_order: number }>;
  locations: Array<{ location_type: string; sheet_id?: number }>;
  categoryIds: number[];
  registrationFields: Array<{
    id: number;
    label: string;
    field_type: string;
    scope: string;
    required: number;
    options: string | null;
    sort_order: number;
  }>;
  confirmedCount: number;
  serverNow?: string;
}

interface PublicTournamentTeam {
  id: number;
  sortOrder: number;
  teamName: string | null;
  homeClub: string | null;
  viceSlotCode: string;
  skipSlotCode: string;
  roster: Array<{ slotCode: string; playerName: string | null }>;
}

interface ArticleData {
  title: string;
  content: string;
  contentType: string;
}

const MS_DAY = 24 * 60 * 60 * 1000;
const MS_WEEK = 7 * MS_DAY;
const MS_HOUR = 60 * 60 * 1000;

function formatTimespanRange(startDt: string, endDt: string): string {
  try {
    const start = new Date(startDt);
    const end = new Date(endDt);
    const sameCalendarDay =
      start.getFullYear() === end.getFullYear() &&
      start.getMonth() === end.getMonth() &&
      start.getDate() === end.getDate();

    const startDateStr = start.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    const startTimeStr = start.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
    const endTimeStr = end.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });

    if (sameCalendarDay) {
      return `${startDateStr}, ${startTimeStr} – ${endTimeStr}`;
    }

    const endDateStr = end.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    return `${startDateStr}, ${startTimeStr} – ${endDateStr}, ${endTimeStr}`;
  } catch {
    return startDt;
  }
}

function formatFee(feeMinor: number, currency: string): string {
  if (feeMinor <= 0) return 'Free';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'usd',
  }).format(feeMinor / 100);
}

/** Public display: club default, or Offsite when any location is offsite. */
function formatPublicLocation(locations: EventDetail['locations']): string {
  if (locations?.some((l) => l.location_type === 'offsite')) {
    return 'Offsite';
  }
  return 'Triangle Curling Club';
}

function effectiveRegistrationCutoff(event: EventDetail): string | null {
  return event.registrationCutoff || event.timespans?.[0]?.start_dt || null;
}

/** Next local calendar date (midnight) on or after `fromTimeMs` whose weekday matches `targetDow` (0–6). */
function nextLocalDateWithWeekday(fromTimeMs: number, targetDow: number): Date {
  const d = new Date(fromTimeMs);
  d.setHours(0, 0, 0, 0);
  const add = (targetDow - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + add);
  return d;
}

function sameLocalCalendarDate(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * When >24h and <1 week: "Registration opens on \<weekday\> at \<time\>".
 * When ≥1 week: weekday-only if registration falls on the next occurrence of that weekday; else full date/time.
 * Otherwise hours or mm:ss for the "Registration opens in …" pattern.
 */
function getRegistrationOpensCopy(
  registrationStartIso: string,
  serverNowMs: number,
  msUntilOpen: number
):
  | { kind: 'datePhrase'; phrase: string }
  | { kind: 'hours'; hours: number }
  | { kind: 'mmss'; value: string } {
  if (msUntilOpen <= 0) {
    return { kind: 'mmss', value: '00:00' };
  }
  if (msUntilOpen > MS_DAY) {
    const reg = new Date(registrationStartIso);
    const weekday = reg.toLocaleDateString('en-US', { weekday: 'long' });
    const timeStr = reg.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    if (msUntilOpen < MS_WEEK) {
      return {
        kind: 'datePhrase',
        phrase: `Registration opens on ${weekday} at ${timeStr}`,
      };
    }

    const nextSlot = nextLocalDateWithWeekday(serverNowMs, reg.getDay());
    if (sameLocalCalendarDate(nextSlot, reg)) {
      return { kind: 'datePhrase', phrase: `Registration opens on ${weekday}` };
    }
    const dateOnly = reg.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    return {
      kind: 'datePhrase',
      phrase: `Registration opens on ${weekday}, ${dateOnly} at ${timeStr}`,
    };
  }
  if (msUntilOpen > MS_HOUR) {
    return { kind: 'hours', hours: Math.floor(msUntilOpen / MS_HOUR) };
  }
  const totalSec = Math.max(0, Math.floor(msUntilOpen / 1000));
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return {
    kind: 'mmss',
    value: `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`,
  };
}

function formatRegistrationClosedAt(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }),
    time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
  };
}

function DetailRow({
  icon: Icon,
  children,
}: {
  icon: typeof HiCalendarDays;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="h-5 w-5 shrink-0 text-gray-400 mt-0.5" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export default function PublicEventDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [article, setArticle] = useState<ArticleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [tick, setTick] = useState(0);
  const [publicTeams, setPublicTeams] = useState<PublicTournamentTeam[]>([]);
  const [publicTeamsFormat, setPublicTeamsFormat] = useState<TournamentFormat | null>(null);
  const [publicTeamsLoading, setPublicTeamsLoading] = useState(false);
  const [publicTeamsError, setPublicTeamsError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    api
      .get(`/public/events/${slug}`)
      .then((res) => {
        setEvent(res.data);
        if (res.data?.serverNow) {
          const serverMs = new Date(res.data.serverNow as string).getTime();
          setServerOffsetMs(serverMs - Date.now());
        } else {
          setServerOffsetMs(0);
        }
        if (res.data?.articleId) {
          return api
            .get(`/public/articles/by-id/${res.data.articleId}`)
            .then((artRes) => {
              setArticle(artRes.data);
            })
            .catch(() => {});
        }
      })
      .catch(() => setError('Event not found'))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    if (!event || loading) return;
    const cal = event.calendarTypeId ?? 'other';
    const showT = cal === 'bonspiel' && (event.tournamentTeamsPublished ?? 0) === 1;
    const showD = cal === 'bonspiel' && (event.tournamentDrawPublished ?? 0) === 1;
    const showBar = showT || showD;
    const t = searchParams.get('tab');
    if (t && t !== 'teams' && t !== 'draw') {
      setSearchParams({}, { replace: true });
      return;
    }
    if (!showBar && t) {
      setSearchParams({}, { replace: true });
      return;
    }
    if (t === 'teams' && !showT) {
      setSearchParams({}, { replace: true });
    } else if (t === 'draw' && !showD) {
      setSearchParams({}, { replace: true });
    }
  }, [event, loading, searchParams, setSearchParams]);

  const serverNowMs = useMemo(() => Date.now() + serverOffsetMs, [serverOffsetMs, tick]);

  const registrationStartMs = event?.registrationStart
    ? new Date(event.registrationStart).getTime()
    : null;
  const cutoffIso = event ? effectiveRegistrationCutoff(event) : null;
  const registrationCutoffMs = cutoffIso ? new Date(cutoffIso).getTime() : null;

  const hasNotOpenedYet =
    registrationStartMs !== null && serverNowMs < registrationStartMs;
  const isPastCutoff =
    registrationCutoffMs !== null && serverNowMs > registrationCutoffMs;
  const isRegistrationOpen = !hasNotOpenedYet && !isPastCutoff;

  const msUntilOpen =
    registrationStartMs !== null ? registrationStartMs - serverNowMs : -1;

  useEffect(() => {
    if (!event?.registrationStart) return;
    const startMs = new Date(event.registrationStart).getTime();
    if (Date.now() + serverOffsetMs >= startMs) return;
    const id = window.setInterval(() => {
      setTick((x) => x + 1);
      if (Date.now() + serverOffsetMs >= startMs) {
        window.clearInterval(id);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [event?.registrationStart, event?.id, serverOffsetMs]);

  const tabParamForTeams = searchParams.get('tab');
  const shouldLoadPublicTeams =
    !!slug &&
    !!event &&
    tabParamForTeams === 'teams' &&
    (event.calendarTypeId ?? 'other') === 'bonspiel' &&
    (event.tournamentTeamsPublished ?? 0) === 1;

  useEffect(() => {
    if (!shouldLoadPublicTeams || !slug) {
      setPublicTeams([]);
      setPublicTeamsFormat(null);
      setPublicTeamsError(null);
      return;
    }
    setPublicTeamsLoading(true);
    setPublicTeamsError(null);
    api
      .get<{ tournamentFormat: TournamentFormat | null; teams: PublicTournamentTeam[] }>(
        `/public/events/${slug}/tournament-teams`,
      )
      .then((res) => {
        setPublicTeamsFormat(
          res.data.tournamentFormat === 'fours' || res.data.tournamentFormat === 'doubles'
            ? res.data.tournamentFormat
            : null,
        );
        setPublicTeams(res.data.teams ?? []);
      })
      .catch(() => {
        setPublicTeamsError('Unable to load teams.');
        setPublicTeams([]);
        setPublicTeamsFormat(null);
      })
      .finally(() => setPublicTeamsLoading(false));
  }, [slug, shouldLoadPublicTeams]);

  const publicFoursLegend = useMemo(() => {
    if (publicTeamsFormat !== 'fours' || publicTeams.length === 0) return null;
    return foursTableLegendText(publicTeams);
  }, [publicTeamsFormat, publicTeams]);

  if (loading) {
    return (
      <PublicLayout>
        <div className="max-w-4xl mx-auto px-4 py-16">
          <PublicStateCard
            title="Loading event..."
            description="Gathering the latest event details and registration information."
          />
        </div>
      </PublicLayout>
    );
  }

  if (error || !event) {
    return (
      <PublicLayout>
        <SeoMeta title="Event Not Found" />
        <div className="max-w-4xl mx-auto px-4 py-16">
          <PublicStateCard
            title="Event not found"
            description="This event may have been removed, unpublished, or is no longer available."
            action={
              <Link to="/events" className="text-sm font-medium text-primary-teal hover:underline">
                Back to events
              </Link>
            }
            tone="error"
          />
        </div>
      </PublicLayout>
    );
  }

  const spotsRemaining =
    event.capacity !== null ? Math.max(0, event.capacity - event.confirmedCount) : null;
  const isFull = spotsRemaining !== null && spotsRemaining <= 0;

  const opensCopy =
    event.registrationStart && hasNotOpenedYet && msUntilOpen > 0
      ? getRegistrationOpensCopy(event.registrationStart, serverNowMs, msUntilOpen)
      : null;
  const closedAtIso = event.registrationCutoff || cutoffIso;
  const closedAtFormatted =
    closedAtIso && isPastCutoff && !hasNotOpenedYet
      ? formatRegistrationClosedAt(closedAtIso)
      : null;

  const calendarTypeId = event.calendarTypeId ?? 'other';
  const showPublicTeams = calendarTypeId === 'bonspiel' && (event.tournamentTeamsPublished ?? 0) === 1;
  const showPublicDraw = calendarTypeId === 'bonspiel' && (event.tournamentDrawPublished ?? 0) === 1;
  const showEventTabs = showPublicTeams || showPublicDraw;
  const tabParam = searchParams.get('tab');
  const publicView: 'details' | 'teams' | 'draw' =
    tabParam === 'teams' && showPublicTeams
      ? 'teams'
      : tabParam === 'draw' && showPublicDraw
        ? 'draw'
        : 'details';

  /** Sidebar competes with wide tournament tables; full-width main on Teams and Draw. */
  const showEventInfoSidebar = publicView === 'details';

  return (
    <PublicLayout>
      <SeoMeta title={event.title} />
      <div className="max-w-6xl mx-auto px-4 py-10">
        <Link to="/events" className="text-sm text-primary-teal hover:underline mb-6 inline-block">
          &larr; All Events
        </Link>

        {showEventTabs ? (
          <PageTabs
            className="mb-6"
            items={[
              {
                key: 'details',
                label: 'Details',
                to: `/events/${event.slug}`,
                isActive: publicView === 'details',
              },
              ...(showPublicTeams
                ? [
                    {
                      key: 'teams',
                      label: 'Teams',
                      to: `/events/${event.slug}?tab=teams`,
                      isActive: publicView === 'teams',
                    },
                  ]
                : []),
              ...(showPublicDraw
                ? [
                    {
                      key: 'draw',
                      label: 'Draw',
                      to: `/events/${event.slug}?tab=draw`,
                      isActive: publicView === 'draw',
                    },
                  ]
                : []),
            ]}
          />
        ) : null}

        <div className="lg:grid lg:grid-cols-12 lg:gap-x-10 lg:items-start">
          <div
            className={`space-y-6 mb-8 lg:mb-0 ${showEventInfoSidebar ? 'lg:col-span-8' : 'lg:col-span-12'}`}
          >
            {publicView === 'details' && (
              <>
                {event.imageFileId && (
                  <div className="rounded-lg overflow-hidden max-h-96">
                    <img
                      src={`/api/public/files/${event.imageFileId}`}
                      alt={event.title}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}

                {article && (
                  <div className="markdown-content max-w-none">
                    {article.contentType === 'html' ? (
                      <div dangerouslySetInnerHTML={{ __html: article.content }} />
                    ) : (
                      <ReactMarkdown remarkPlugins={[remarkBreaks, remarkGfm]}>
                        {article.content}
                      </ReactMarkdown>
                    )}
                  </div>
                )}
              </>
            )}

            {publicView === 'teams' && (
              <div className="public-card p-6 text-gray-700 dark:text-gray-300">
                <h2 className="public-subheading text-xl mb-4">Teams</h2>
                {publicTeamsLoading ? (
                  <p className="text-sm text-gray-600 dark:text-gray-400">Loading teams…</p>
                ) : publicTeamsError ? (
                  <p className="text-sm text-red-700 dark:text-red-300">{publicTeamsError}</p>
                ) : !publicTeamsFormat ? (
                  <p className="text-sm text-gray-600 dark:text-gray-400">No team format is configured yet.</p>
                ) : (
                  <div className="overflow-x-auto -mx-2 px-2">
                    <table className="min-w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-600 text-left">
                          <th className="py-2 pr-4 font-semibold text-gray-900 dark:text-gray-100">Team</th>
                          <th className="py-2 pr-4 font-semibold text-gray-900 dark:text-gray-100">Home club</th>
                          {tableSlotsForFormat(publicTeamsFormat).map((slotCode) => (
                            <th
                              key={slotCode}
                              className="py-2 pr-4 font-semibold text-gray-900 dark:text-gray-100 whitespace-nowrap"
                            >
                              {slotLabel(publicTeamsFormat, slotCode)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[...publicTeams]
                          .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
                          .map((t) => (
                            <tr
                              key={t.id}
                              className="border-b border-gray-100 dark:border-gray-700/80 align-top"
                            >
                              <td className="py-3 pr-4 font-medium text-gray-900 dark:text-gray-100">
                                {formatTeamDisplayName(t.teamName, t.sortOrder)}
                              </td>
                              <td className="py-3 pr-4 text-gray-700 dark:text-gray-300">
                                {t.homeClub?.trim() || '—'}
                              </td>
                              {tableSlotsForFormat(publicTeamsFormat).map((slotCode) => (
                                <td
                                  key={slotCode}
                                  className="py-3 pr-4 text-gray-700 dark:text-gray-300 whitespace-nowrap"
                                >
                                  {formatPositionCell(
                                    publicTeamsFormat,
                                    t.roster,
                                    slotCode,
                                    t.viceSlotCode,
                                    t.skipSlotCode,
                                  )}
                                </td>
                              ))}
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    {publicFoursLegend ? (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">{publicFoursLegend}</p>
                    ) : null}
                    {publicTeams.length === 0 ? (
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-4">No teams listed yet.</p>
                    ) : null}
                  </div>
                )}
              </div>
            )}

            {publicView === 'draw' && (
              <div className="public-card p-6 text-gray-700 dark:text-gray-300">
                <h2 className="public-subheading text-xl mb-2">Draw</h2>
                <p className="text-sm">The competition draw will appear here.</p>
              </div>
            )}
          </div>

          {showEventInfoSidebar ? (
            <aside className="lg:col-span-4 lg:sticky lg:top-6 mb-8 lg:mb-0 self-start">
              <div className="bg-gray-50 rounded-lg p-6 space-y-4">
                {event.timespans.map((ts) => (
                  <DetailRow key={ts.id} icon={HiCalendarDays}>
                    <p className="text-gray-900 font-medium">
                      {formatTimespanRange(ts.start_dt, ts.end_dt)}
                    </p>
                  </DetailRow>
                ))}

                <DetailRow icon={HiMapPin}>
                  <p className="text-gray-700">{formatPublicLocation(event.locations)}</p>
                </DetailRow>

                <DetailRow icon={HiCurrencyDollar}>
                  <div className="text-gray-700">
                    {event.memberFeeMinor != null && event.memberFeeMinor !== event.feeMinor ? (
                      <>
                        <p>{formatFee(event.feeMinor, event.currency)} general</p>
                        <p className="text-sm text-gray-600 mt-0.5">
                          {formatFee(event.memberFeeMinor, event.currency)} for members when logged in
                        </p>
                      </>
                    ) : (
                      <p>{formatFee(event.feeMinor, event.currency)}</p>
                    )}
                  </div>
                </DetailRow>

                {event.capacity !== null && (
                  <DetailRow icon={HiUserGroup}>
                    <div className="text-gray-700 space-y-1">
                      <p>
                        {event.confirmedCount} of {event.capacity} registered
                      </p>
                      {isFull && (
                        <p className="text-sm">
                          {isRegistrationOpen && event.enableWaitlist === 1
                            ? 'Event is full – waitlist available'
                            : 'Event is full'}
                        </p>
                      )}
                      {!isFull && spotsRemaining !== null && (
                        <p className="text-sm text-gray-600">{spotsRemaining} spots remaining</p>
                      )}
                    </div>
                  </DetailRow>
                )}

                <div className="border-t border-gray-200 pt-4 mt-1 space-y-4">
                  {opensCopy && opensCopy.kind === 'datePhrase' && (
                    <p className="text-sm text-gray-700">{opensCopy.phrase}</p>
                  )}
                  {opensCopy && opensCopy.kind !== 'datePhrase' && (
                    <p className="text-sm text-gray-700">
                      Registration opens in{' '}
                      <span
                        className="font-medium text-gray-900 tabular-nums"
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        {opensCopy.kind === 'hours'
                          ? `${opensCopy.hours} ${opensCopy.hours === 1 ? 'hour' : 'hours'}`
                          : opensCopy.value}
                      </span>
                    </p>
                  )}

                  {opensCopy?.kind === 'mmss' && hasNotOpenedYet && msUntilOpen > 0 && (
                    <div className="space-y-2">
                      <Link
                        to={`/events/${event.slug}/register`}
                        className="block w-full text-center px-4 py-3 bg-white border-2 border-primary-teal text-primary-teal font-medium rounded-lg hover:bg-teal-50 transition-colors"
                      >
                        Prefill registration form
                      </Link>
                      <p className="text-xs text-gray-600">
                        You may prefill your registration form. As soon as registration opens, you will be able to submit
                        your registration
                        {event.feeMinor > 0 ? ' and pay the registration fee' : ''}.
                      </p>
                    </div>
                  )}

                  {isPastCutoff && !hasNotOpenedYet && closedAtFormatted && (
                    <p className="text-sm text-gray-700">
                      Registration closed on {closedAtFormatted.date} at {closedAtFormatted.time}
                    </p>
                  )}

                  {isRegistrationOpen && !isFull && (
                    <Link
                      to={`/events/${event.slug}/register`}
                      className="block w-full text-center px-4 py-3 bg-primary-teal text-white font-medium rounded-lg hover:bg-teal-700 transition-colors"
                    >
                      Register Now
                    </Link>
                  )}

                  {isRegistrationOpen && isFull && event.enableWaitlist === 1 && (
                    <Link
                      to={`/events/${event.slug}/register`}
                      className="block w-full text-center px-4 py-3 bg-gray-600 text-white font-medium rounded-lg hover:bg-gray-700 transition-colors"
                    >
                      Join Waitlist
                    </Link>
                  )}
                </div>
              </div>
            </aside>
          ) : null}
        </div>
      </div>
    </PublicLayout>
  );
}
