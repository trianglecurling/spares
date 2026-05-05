import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import SeoMeta from '../components/SeoMeta';
import TeamTournamentDrawPathDiagram from '../components/TeamTournamentDrawPathDiagram';
import { useDelayedTrueWhile } from '../hooks/useDelayedTrueWhile';
import api from '../utils/api';
import type { TournamentDrawState } from '../utils/tournamentDrawModel';
import { formatTeamDisplayName, type TournamentFormat } from '../utils/tournamentDisplay';

interface EventDetail {
  id: number;
  title: string;
  slug: string;
  calendarTypeId?: string;
  tournamentTeamsPublished?: number;
  tournamentDrawPublished?: number;
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

export default function PublicEventTeamPage() {
  const { slug, teamId: teamIdParam } = useParams<{ slug: string; teamId: string }>();
  const [searchParams] = useSearchParams();
  const specialLinkQuery = searchParams.get('slk');
  const alignColumnRef = useRef<HTMLDivElement>(null);

  const teamId = teamIdParam ? Number.parseInt(teamIdParam, 10) : NaN;

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [eventLoading, setEventLoading] = useState(true);
  const [eventError, setEventError] = useState(false);

  const [publicTeams, setPublicTeams] = useState<PublicTournamentTeam[]>([]);
  const [publicTeamsFormat, setPublicTeamsFormat] = useState<TournamentFormat | null>(null);
  const [publicTeamsLoading, setPublicTeamsLoading] = useState(true);
  const [publicTeamsError, setPublicTeamsError] = useState<string | null>(null);

  const [publicDraw, setPublicDraw] = useState<TournamentDrawState | null | undefined>(undefined);
  const [publicDrawLoading, setPublicDrawLoading] = useState(false);
  const [publicDrawError, setPublicDrawError] = useState<string | null>(null);
  /** Holds diagram `resetView`; ref avoids setState in the child’s effect (React cross-render warning). */
  const resetBracketPathRef = useRef<(() => void) | null>(null);

  const onBracketResetReady = useCallback((fn: (() => void) | null) => {
    resetBracketPathRef.current = fn;
  }, []);

  useEffect(() => {
    if (!slug) return;
    setEventLoading(true);
    setEventError(false);
    api
      .get(`/public/events/${slug}`)
      .then((res) => setEvent(res.data))
      .catch(() => setEventError(true))
      .finally(() => setEventLoading(false));
  }, [slug]);

  const showPublicTeams =
    !!event && (event.calendarTypeId ?? 'other') === 'bonspiel' && (event.tournamentTeamsPublished ?? 0) === 1;
  const showPublicDraw =
    !!event && (event.calendarTypeId ?? 'other') === 'bonspiel' && (event.tournamentDrawPublished ?? 0) === 1;

  useEffect(() => {
    if (!slug || !showPublicTeams) {
      setPublicTeams([]);
      setPublicTeamsFormat(null);
      setPublicTeamsError(null);
      setPublicTeamsLoading(false);
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
  }, [slug, showPublicTeams]);

  useEffect(() => {
    if (!slug || !showPublicDraw) {
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
      .then((res) => setPublicDraw(res.data.draw ?? null))
      .catch(() => {
        setPublicDrawError('Unable to load draw.');
        setPublicDraw(null);
      })
      .finally(() => setPublicDrawLoading(false));
  }, [slug, showPublicDraw, specialLinkQuery]);

  useEffect(() => {
    if (!slug || !showPublicDraw) return;

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
          .catch(() => setPublicDrawError('Unable to load draw.'));
      } catch {
        // ignore
      }
    };

    return () => {
      es.close();
    };
  }, [slug, showPublicDraw, specialLinkQuery]);

  const team = useMemo(
    () => publicTeams.find((t) => t.id === teamId) ?? null,
    [publicTeams, teamId],
  );

  const drawTabTeamsById = useMemo(
    () =>
      new Map(
        publicTeams.map((t) => [t.id, { teamName: t.teamName, sortOrder: t.sortOrder }] as const),
      ),
    [publicTeams],
  );

  const teamsListHref = useMemo(() => {
    const base = slug ? `/events/${slug}?tab=teams` : '/events';
    if (!specialLinkQuery) return base;
    return `${base}&slk=${encodeURIComponent(specialLinkQuery)}`;
  }, [slug, specialLinkQuery]);

  const loadingDelayMs = 2000;
  const blockingGate = eventLoading || (showPublicTeams && publicTeamsLoading);
  const showBlockingLoadingCard = useDelayedTrueWhile(blockingGate, loadingDelayMs);

  const drawLoadPending = showPublicDraw && (publicDrawLoading || publicDraw === undefined);
  const showDrawLoadingCard = useDelayedTrueWhile(drawLoadPending, loadingDelayMs);

  if (!slug || Number.isNaN(teamId)) {
    return (
      <PublicLayout>
        <SeoMeta title="Team" />
        <div className="max-w-4xl mx-auto px-4 py-16">
          <PublicStateCard
            title="Invalid link"
            description="This team link is not valid."
            action={
              <Link to="/events" className="text-sm font-medium text-primary-teal-link hover:underline">
                All events
              </Link>
            }
            tone="error"
          />
        </div>
      </PublicLayout>
    );
  }

  if (blockingGate) {
    return (
      <PublicLayout>
        <SeoMeta title={!event ? 'Loading…' : event.title} />
        {showBlockingLoadingCard ? (
          <div className="max-w-4xl mx-auto px-4 py-16">
            <PublicStateCard title="Loading…" description="Please wait." />
          </div>
        ) : (
          <div className="min-h-[min(45vh,28rem)]" aria-hidden />
        )}
      </PublicLayout>
    );
  }

  if (eventError || !event) {
    return (
      <PublicLayout>
        <SeoMeta title="Event not found" />
        <div className="max-w-4xl mx-auto px-4 py-16">
          <PublicStateCard
            title="Event not found"
            description="This event may have been removed or is no longer available."
            action={
              <Link to="/events" className="text-sm font-medium text-primary-teal-link hover:underline">
                All events
              </Link>
            }
            tone="error"
          />
        </div>
      </PublicLayout>
    );
  }

  if (!showPublicTeams) {
    return (
      <PublicLayout>
        <SeoMeta title={event.title} />
        <div className="max-w-4xl mx-auto px-4 py-16">
          <PublicStateCard
            title="Teams not available"
            description="Published team lists are not available for this event."
            action={
              <Link
                to={`/events/${event.slug}`}
                className="text-sm font-medium text-primary-teal-link hover:underline"
              >
                Event details
              </Link>
            }
          />
        </div>
      </PublicLayout>
    );
  }

  if (publicTeamsError || !publicTeamsFormat) {
    return (
      <PublicLayout>
        <SeoMeta title={event.title} />
        <div className="max-w-4xl mx-auto px-4 py-16">
          <PublicStateCard
            title="Unable to load team"
            description={publicTeamsError ?? 'No team format is configured for this event.'}
            action={
              <Link to={teamsListHref} className="text-sm font-medium text-primary-teal-link hover:underline">
                Back to teams
              </Link>
            }
            tone="error"
          />
        </div>
      </PublicLayout>
    );
  }

  if (!team) {
    return (
      <PublicLayout>
        <SeoMeta title={`Team · ${event.title}`} />
        <div className="max-w-4xl mx-auto px-4 py-16">
          <PublicStateCard
            title="Team not found"
            description="This team is not listed for this event."
            action={
              <Link to={teamsListHref} className="text-sm font-medium text-primary-teal-link hover:underline">
                Back to teams
              </Link>
            }
            tone="error"
          />
        </div>
      </PublicLayout>
    );
  }

  const pageTitle = formatTeamDisplayName(team.teamName, team.sortOrder);
  const headingText = `${pageTitle} bracket path`;

  const showBracketDiagram =
    showPublicDraw &&
    !publicDrawLoading &&
    publicDraw !== undefined &&
    !publicDrawError &&
    publicDraw !== null;

  return (
    <PublicLayout>
      <SeoMeta title={`${headingText} · ${event.title}`} />
      <div className="flex flex-1 min-h-0 flex-col w-full min-w-0">
        <div
          ref={alignColumnRef}
          className="shrink-0 w-full max-w-6xl min-w-0 mx-auto px-4 sm:px-6 pt-8 pb-2"
        >
          <Link
            to={teamsListHref}
            className="text-sm text-primary-teal-link hover:underline mb-3 inline-block"
          >
            &larr; Teams for {event.title}
          </Link>
          <div className="public-page-title-rule">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="public-heading text-2xl sm:text-3xl min-w-0 flex-1">
                {headingText}
              </h1>
              {showBracketDiagram ? (
                <button
                  type="button"
                  className="shrink-0 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700/80"
                  onClick={() => resetBracketPathRef.current?.()}
                >
                  Reset view
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {showPublicDraw ? (
          drawLoadPending ? (
            showDrawLoadingCard ? (
              <div className="shrink-0 w-full max-w-6xl mx-auto px-4 sm:px-6 pb-10">
                <div className="max-w-4xl mx-auto">
                  <PublicStateCard title="Loading…" description="Please wait." />
                </div>
              </div>
            ) : (
              <div className="min-h-[min(40vh,24rem)] shrink-0" aria-hidden />
            )
          ) : publicDrawError ? (
            <div className="shrink-0 max-w-6xl mx-auto px-4 sm:px-6 pb-10 text-gray-700 dark:text-gray-300">
              <p className="text-sm text-red-700 dark:text-red-300">{publicDrawError}</p>
            </div>
          ) : publicDraw === null ? (
            <div className="shrink-0 max-w-6xl mx-auto px-4 sm:px-6 pb-10 text-gray-700 dark:text-gray-300">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                The draw has not been set up yet.
              </p>
            </div>
          ) : publicDraw != null ? (
            <div className="flex flex-1 min-h-0 flex-col w-full min-w-0">
              <TeamTournamentDrawPathDiagram
                alignContentColumnRef={alignColumnRef}
                draw={publicDraw}
                teamId={team.id}
                teamsById={drawTabTeamsById}
                onResetViewReady={onBracketResetReady}
              />
            </div>
          ) : null
        ) : (
          <div className="shrink-0 max-w-6xl mx-auto px-4 sm:px-6 pb-10 text-gray-700 dark:text-gray-300">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              The tournament draw is not published, so a bracket path cannot be shown.
            </p>
          </div>
        )}
      </div>
    </PublicLayout>
  );
}
