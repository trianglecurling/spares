import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import PublicTournamentDrawPhases from '../components/PublicTournamentDrawPhases';
import PublicEventLiveScores from '../components/PublicEventLiveScores';
import PublicEventInfoPanel from '../components/PublicEventInfoPanel';
import PublicEventTeamsTable, { type PublicTournamentTeam } from '../components/PublicEventTeamsTable';
import PageTabs from '../components/PageTabs';
import { ArticleMarkdown } from '../components/ArticleMarkdown';
import SeoMeta from '../components/SeoMeta';
import PublicNotFoundPage from './PublicNotFoundPage';
import { useDelayedTrueWhile } from '../hooks/useDelayedTrueWhile';
import api from '../utils/api';
import { teamIdsAssignedOnDraw, type TournamentDrawState } from '../utils/tournamentDrawModel';
import { getEarliestStartMs, isLiveScoresWindowOpen } from '../utils/fiscalSeason';
import { drawHasRecordedScores } from '../utils/tournamentDrawResultsRows';
import { isBonspielCalendarType } from '../utils/eventCalendarTypes';
import type { TournamentTeamApi } from '../types/tournamentTeam';
import type { TournamentFormat } from '../utils/tournamentDisplay';

interface EventDetail {
  id: number;
  title: string;
  slug: string;
  articleId: number | null;
  imageFileId: number | null;
  visibility: string;
  published: number;
  calendarTypeIds?: string[];
  tournamentFormat?: 'fours' | 'doubles' | null;
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
  pointOfContact: string;
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
  waitlistedCount?: number;
  openSpots?: number | null;
  serverNow?: string;
}

interface ArticleData {
  title: string;
  content: string;
  contentType: string;
}

const MS_DAY = 24 * 60 * 60 * 1000;

export default function PublicEventDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [article, setArticle] = useState<ArticleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [publicTeams, setPublicTeams] = useState<PublicTournamentTeam[]>([]);
  const [publicTeamsFormat, setPublicTeamsFormat] = useState<TournamentFormat | null>(null);
  const [publicTeamsLoading, setPublicTeamsLoading] = useState(false);
  const [publicTeamsError, setPublicTeamsError] = useState<string | null>(null);
  const [publicDraw, setPublicDraw] = useState<TournamentDrawState | null | undefined>(undefined);
  const [publicDrawLoading, setPublicDrawLoading] = useState(false);
  const [publicDrawError, setPublicDrawError] = useState<string | null>(null);
  /** Bumps when the 24-hour live-scores window opens so the tab appears without a reload. */
  const [scoresClock, setScoresClock] = useState(0);
  /** Aligns public bracket baseline pan with this column (tabs / max-w-6xl + horizontal padding). */
  const publicBracketAlignColumnRef = useRef<HTMLDivElement>(null);

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
    const cal = event.calendarTypeIds ?? [];
    const showT = isBonspielCalendarType(cal) && (event.tournamentTeamsPublished ?? 0) === 1;
    const showD = isBonspielCalendarType(cal) && (event.tournamentDrawPublished ?? 0) === 1;
    const nowMs = Date.now() + serverOffsetMs;
    const windowOpen = isLiveScoresWindowOpen(event.timespans, nowMs);
    const showScores = showD && (windowOpen || drawHasRecordedScores(publicDraw));
    // The draw may still be loading; don't drop ?tab=scores before we can see recorded scores.
    const scoresDecisionPending = showD && !windowOpen && publicDraw === undefined;
    const showBar = showT || showD;
    const t = searchParams.get('tab');
    const clearTab = () => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams();
          const slk = prev.get('slk');
          if (slk) next.set('slk', slk);
          return next;
        },
        { replace: true }
      );
    };
    if (t && t !== 'teams' && t !== 'draw' && t !== 'scores') {
      clearTab();
      return;
    }
    if (!showBar && t) {
      clearTab();
      return;
    }
    if (t === 'teams' && !showT) {
      clearTab();
    } else if (t === 'draw' && !showD) {
      clearTab();
    } else if (t === 'scores' && !showScores && !scoresDecisionPending) {
      clearTab();
    }
  }, [event, loading, publicDraw, searchParams, setSearchParams, serverOffsetMs, scoresClock]);

  const serverNowMs = useMemo(
    () => Date.now() + serverOffsetMs,
    [serverOffsetMs, scoresClock]
  );

  useEffect(() => {
    if (!event || loading) return;
    const startMs = getEarliestStartMs(event.timespans);
    if (!Number.isFinite(startMs)) return;
    const openAt = startMs - MS_DAY;
    const remaining = openAt - (Date.now() + serverOffsetMs);
    if (remaining <= 0) return;
    // setTimeout delay is a 32-bit signed int; reschedule if the window is farther out.
    const delay = Math.min(remaining, 2_147_483_647);
    const id = window.setTimeout(() => setScoresClock((n) => n + 1), delay);
    return () => window.clearTimeout(id);
  }, [event, loading, serverOffsetMs, scoresClock]);

  const tabParam = searchParams.get('tab');
  const specialLinkQuery = searchParams.get('slk');
  /** Load roster for Teams / Draw / Live scores team labels. */
  const shouldLoadTournamentTeams =
    !!slug &&
    !!event &&
    (tabParam === 'teams' ||
      tabParam === 'draw' ||
      tabParam === 'scores' ||
      (event.tournamentDrawPublished ?? 0) === 1) &&
    isBonspielCalendarType(event.calendarTypeIds) &&
    (event.tournamentTeamsPublished ?? 0) === 1;

  useEffect(() => {
    if (!shouldLoadTournamentTeams || !slug) {
      setPublicTeams([]);
      setPublicTeamsFormat(null);
      setPublicTeamsError(null);
      return;
    }
    setPublicTeamsLoading(true);
    setPublicTeamsError(null);
    api
      .get<{ tournamentFormat: TournamentFormat | null; teams: PublicTournamentTeam[] }>(
        `/public/events/${slug}/tournament-teams`
      )
      .then((res) => {
        setPublicTeamsFormat(
          res.data.tournamentFormat === 'fours' || res.data.tournamentFormat === 'doubles'
            ? res.data.tournamentFormat
            : null
        );
        setPublicTeams(res.data.teams ?? []);
      })
      .catch(() => {
        setPublicTeamsError('Unable to load teams.');
        setPublicTeams([]);
        setPublicTeamsFormat(null);
      })
      .finally(() => setPublicTeamsLoading(false));
  }, [slug, shouldLoadTournamentTeams]);

  /** Load whenever the draw is published so Live scores tab visibility can update via SSE. */
  const shouldLoadPublicDraw =
    !!slug &&
    !!event &&
    isBonspielCalendarType(event.calendarTypeIds) &&
    (event.tournamentDrawPublished ?? 0) === 1;

  useEffect(() => {
    if (!shouldLoadPublicDraw || !slug) {
      setPublicDraw(undefined);
      setPublicDrawError(null);
      return;
    }
    setPublicDrawLoading(true);
    setPublicDrawError(null);
    api
      .get<{ draw: TournamentDrawState | null }>(`/public/events/${slug}/tournament-draw`, {
        params: specialLinkQuery ? { slk: specialLinkQuery } : undefined,
      })
      .then((res) => {
        setPublicDraw(res.data.draw ?? null);
      })
      .catch(() => {
        setPublicDrawError('Unable to load draw.');
        setPublicDraw(null);
      })
      .finally(() => setPublicDrawLoading(false));
  }, [slug, shouldLoadPublicDraw, specialLinkQuery]);

  useEffect(() => {
    if (!shouldLoadPublicDraw || !slug) return;

    const qs = new URLSearchParams();
    if (specialLinkQuery) qs.set('slk', specialLinkQuery);
    const query = qs.toString();
    const streamUrl = `/api/public/events/${encodeURIComponent(slug)}/tournament-draw/stream${
      query ? `?${query}` : ''
    }`;

    const es = new EventSource(streamUrl);

    es.onmessage = (ev: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(ev.data) as { type?: string };
        if (msg.type !== 'tournament_draw_updated') return;
        api
          .get<{ draw: TournamentDrawState | null }>(`/public/events/${slug}/tournament-draw`, {
            params: specialLinkQuery ? { slk: specialLinkQuery } : undefined,
          })
          .then((res) => {
            setPublicDraw(res.data.draw ?? null);
            setPublicDrawError(null);
          })
          .catch(() => {
            setPublicDrawError('Unable to load draw.');
          });
      } catch {
        // Ignore malformed SSE payloads.
      }
    };

    return () => {
      es.close();
    };
  }, [slug, shouldLoadPublicDraw, specialLinkQuery]);

  const drawTabTeamsById = useMemo(
    () =>
      new Map(
        publicTeams.map(
          (t) =>
            [
              t.id,
              {
                teamName: t.teamName,
                sortOrder: t.sortOrder,
                homeClub: t.homeClub,
                viceSlotCode: t.viceSlotCode,
                skipSlotCode: t.skipSlotCode,
                roster: t.roster,
              },
            ] as const
        )
      ),
    [publicTeams]
  );

  const teamIdsOnDraw = useMemo(() => {
    if (!publicDraw) return null;
    return teamIdsAssignedOnDraw(publicDraw);
  }, [publicDraw]);

  const loadingDelayMs = 2000;
  const drawLoadPending =
    !!event &&
    !loading &&
    tabParam === 'draw' &&
    isBonspielCalendarType(event.calendarTypeIds) &&
    (event.tournamentDrawPublished ?? 0) === 1 &&
    (publicDrawLoading || publicDraw === undefined);
  const scoresLoadPending =
    !!event &&
    !loading &&
    tabParam === 'scores' &&
    isBonspielCalendarType(event.calendarTypeIds) &&
    (event.tournamentDrawPublished ?? 0) === 1 &&
    (publicDrawLoading || publicDraw === undefined || publicTeamsLoading);
  const teamsLoadPending =
    !!event &&
    !loading &&
    tabParam === 'teams' &&
    isBonspielCalendarType(event.calendarTypeIds) &&
    (event.tournamentTeamsPublished ?? 0) === 1 &&
    publicTeamsLoading;

  const showInitialLoadingCard = useDelayedTrueWhile(loading, loadingDelayMs);
  const showDrawLoadingCard = useDelayedTrueWhile(drawLoadPending, loadingDelayMs);
  const showScoresLoadingCard = useDelayedTrueWhile(scoresLoadPending, loadingDelayMs);
  const showTeamsLoadingCard = useDelayedTrueWhile(teamsLoadPending, loadingDelayMs);

  if (loading) {
    return (
      <PublicLayout>
        <SeoMeta title="Loading…" />
        <div className="max-w-4xl mx-auto px-4 py-16">
          {showInitialLoadingCard ? (
            <PublicStateCard title="Loading…" description="Please wait." />
          ) : (
            <div className="min-h-[min(45vh,28rem)]" aria-hidden />
          )}
        </div>
      </PublicLayout>
    );
  }

  if (error || !event) {
    return (
      <PublicNotFoundPage
        title="Event not found"
        description="This event may have been removed, unpublished, or is no longer available."
        seoTitle="Event not found | Triangle Curling Club"
        showCode={false}
      />
    );
  }

  const calendarTypeIds = event.calendarTypeIds ?? [];
  const showPublicTeams =
    isBonspielCalendarType(calendarTypeIds) && (event.tournamentTeamsPublished ?? 0) === 1;
  const showPublicDraw =
    isBonspielCalendarType(calendarTypeIds) && (event.tournamentDrawPublished ?? 0) === 1;
  const showLiveScores =
    showPublicDraw &&
    (isLiveScoresWindowOpen(event.timespans, serverNowMs) || drawHasRecordedScores(publicDraw));
  const showEventTabs = showPublicTeams || showPublicDraw;
  // Live scores opens 24 hours before the event starts, or as soon as any score is recorded.
  const publicView: 'details' | 'teams' | 'draw' | 'scores' =
    tabParam === 'teams' && showPublicTeams
      ? 'teams'
      : tabParam === 'draw' && showPublicDraw
        ? 'draw'
        : tabParam === 'scores' && showPublicDraw
          ? 'scores'
          : 'details';

  const liveScoresTeams: TournamentTeamApi[] = publicTeams.map((t) => ({
    id: t.id,
    sortOrder: t.sortOrder,
    teamName: t.teamName,
    homeClub: t.homeClub,
    viceSlotCode: t.viceSlotCode,
    skipSlotCode: t.skipSlotCode,
    roster: t.roster.map((r) => ({
      slotCode: r.slotCode,
      playerName: r.playerName,
      email: null,
      notes: null,
      homeClub: null,
    })),
  }));

  const eventTabHref = (tab?: 'teams' | 'draw' | 'scores') => {
    const qs = new URLSearchParams();
    if (tab) qs.set('tab', tab);
    if (specialLinkQuery) qs.set('slk', specialLinkQuery);
    const q = qs.toString();
    return q ? `/events/${event.slug}?${q}` : `/events/${event.slug}`;
  };

  /** Sidebar competes with wide tournament tables; full-width main on Teams, Draw, and Live scores. */
  const showEventInfoSidebar = publicView === 'details';
  /** Public page heading uses the Details tab article title when present. */
  const displayTitle = article?.title?.trim() || event.title;

  return (
    <PublicLayout>
      <div className="flex flex-1 min-h-0 flex-col w-full min-w-0">
        <SeoMeta title={displayTitle} />
        <div
          ref={publicBracketAlignColumnRef}
          className="shrink-0 w-full max-w-6xl min-w-0 mx-auto px-4 sm:px-6 pt-10 pb-4"
        >
          <Link
            to="/events"
            className="text-sm text-primary-teal-link hover:underline mb-3 inline-block"
          >
            &larr; All events
          </Link>

          <div
            className={
              showEventTabs
                ? 'public-page-title-rule public-page-title-rule--with-tabs'
                : 'public-page-title-rule'
            }
          >
            <h1 className="public-heading text-balance min-w-0">{displayTitle}</h1>
          </div>

          {showEventTabs ? (
            <PageTabs
              className="w-full"
              items={[
                {
                  key: 'details',
                  label: 'Details',
                  to: eventTabHref(),
                  isActive: publicView === 'details',
                },
                ...(showPublicTeams
                  ? [
                      {
                        key: 'teams',
                        label: 'Teams',
                        to: eventTabHref('teams'),
                        isActive: publicView === 'teams',
                      },
                    ]
                  : []),
                ...(showPublicDraw
                  ? [
                      {
                        key: 'draw',
                        label: 'Draw',
                        to: eventTabHref('draw'),
                        isActive: publicView === 'draw',
                      },
                    ]
                  : []),
                ...(showLiveScores
                  ? [
                      {
                        key: 'scores',
                        label: 'Live scores',
                        to: eventTabHref('scores'),
                        isActive: publicView === 'scores',
                      },
                    ]
                  : []),
              ]}
            />
          ) : null}
        </div>

        {publicView === 'scores' ? (
          scoresLoadPending ? (
            showScoresLoadingCard ? (
              <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-10 shrink-0 text-gray-700 dark:text-gray-300">
                <div className="max-w-4xl mx-auto">
                  <PublicStateCard title="Loading…" description="Please wait." />
                </div>
              </div>
            ) : (
              <div className="min-h-[min(40vh,24rem)] shrink-0" aria-hidden />
            )
          ) : publicDrawError ? (
            <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-10 shrink-0 text-gray-700 dark:text-gray-300">
              <p className="text-sm text-red-700 dark:text-red-300">{publicDrawError}</p>
            </div>
          ) : publicDraw != null ? (
            <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-10 w-full min-w-0 text-gray-700 dark:text-gray-300">
              <p className="mb-4 text-sm">
                All games are streamed live to our{' '}
                <a
                  href="https://www.youtube.com/@TriangleCurling/streams"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-teal-link hover:underline"
                >
                  YouTube Channel
                </a>
                .
              </p>
              <PublicEventLiveScores
                draw={publicDraw}
                teams={liveScoresTeams}
                tournamentFormat={publicTeamsFormat ?? 'fours'}
                serverOffsetMs={serverOffsetMs}
              />
            </div>
          ) : null
        ) : publicView === 'draw' ? (
          publicDrawLoading || publicDraw === undefined ? (
            showDrawLoadingCard ? (
              <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-10 shrink-0 text-gray-700 dark:text-gray-300">
                <div className="max-w-4xl mx-auto">
                  <PublicStateCard title="Loading…" description="Please wait." />
                </div>
              </div>
            ) : (
              <div className="min-h-[min(40vh,24rem)] shrink-0" aria-hidden />
            )
          ) : publicDrawError ? (
            <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-10 shrink-0 text-gray-700 dark:text-gray-300">
              <p className="text-sm text-red-700 dark:text-red-300">{publicDrawError}</p>
            </div>
          ) : publicDraw === null ? (
            <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-10 shrink-0 text-gray-700 dark:text-gray-300">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                The draw has not been set up yet. Check back later.
              </p>
            </div>
          ) : publicDraw != null ? (
            <div className="flex flex-1 min-h-0 flex-col w-full min-w-0 text-gray-700 dark:text-gray-300">
              <PublicTournamentDrawPhases
                draw={publicDraw}
                teamsById={drawTabTeamsById}
                title={displayTitle}
                filenameBase={event.slug || event.title}
                alignContentColumnRef={publicBracketAlignColumnRef}
                tournamentFormat={publicTeamsFormat ?? 'fours'}
              />
            </div>
          ) : null
        ) : (
          <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-10 w-full min-w-0">
            <div className="flex flex-col lg:grid lg:grid-cols-12 lg:gap-x-10 lg:items-start">
              <div
                className={`order-2 lg:order-none space-y-6 ${showEventInfoSidebar ? 'mb-0 lg:mb-0 lg:col-span-8' : 'mb-8 lg:mb-0 lg:col-span-12'}`}
              >
                {publicView === 'details' && (
                  <>
                    {event.imageFileId && (
                      <div className="rounded-lg overflow-hidden max-h-96">
                        <img
                          src={`/api/public/files/${event.imageFileId}`}
                          alt={displayTitle}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}

                    {article && (
                      <div>
                        {article.contentType === 'html' ? (
                          <div className="markdown-content max-w-none">
                            <div dangerouslySetInnerHTML={{ __html: article.content }} />
                          </div>
                        ) : (
                          <ArticleMarkdown markdown={article.content} />
                        )}
                      </div>
                    )}
                  </>
                )}

                {publicView === 'teams' && (
                  <PublicEventTeamsTable
                    eventSlug={event.slug}
                    teams={publicTeams}
                    format={publicTeamsFormat}
                    loading={publicTeamsLoading}
                    error={publicTeamsError}
                    showLoadingCard={showTeamsLoadingCard}
                    linkTeamIds={showPublicDraw ? teamIdsOnDraw : null}
                    specialLinkQuery={specialLinkQuery}
                  />
                )}
              </div>

              {showEventInfoSidebar ? (
                <aside className="order-1 lg:order-none lg:col-span-4 lg:sticky lg:top-6 mb-8 lg:mb-0 self-start">
                  <PublicEventInfoPanel event={event} serverOffsetMs={serverOffsetMs} />
                </aside>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </PublicLayout>
  );
}
