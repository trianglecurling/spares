import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import FormSection from '../../components/FormSection';
import api, { formatApiError } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import type { TournamentFormat } from '../../utils/tournamentDisplay';
import type { TournamentTeamApi } from '../../types/tournamentTeam';
import AdminTournamentDrawEditor from './AdminTournamentDrawEditor';

function isDrawWorkspaceHash(hash: string): boolean {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  return raw === 'setup' || raw === 'structure';
}

type AdminEventTournamentPanelProps = {
  eventId: number;
  eventTitle: string;
  /** Reserved for future format-aware UI; format is derived from event type. */
  tournamentFormat: TournamentFormat;
  initialTeamsPublished: boolean;
  initialDrawPublished: boolean;
  onSaved?: (teamsPublished: boolean, drawPublished: boolean) => void;
};

function switchTrackClass(active: boolean, disabled: boolean): string {
  return [
    'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
    'focus:outline-none focus:ring-2 focus:ring-primary-teal focus:ring-offset-2 dark:focus:ring-offset-gray-900',
    active ? 'bg-primary-teal' : 'bg-gray-200 dark:bg-gray-600',
    disabled ? 'cursor-not-allowed opacity-60' : '',
  ].join(' ');
}

function switchThumbClass(active: boolean): string {
  return [
    'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition',
    active ? 'translate-x-5' : 'translate-x-1',
  ].join(' ');
}

export default function AdminEventTournamentPanel({
  eventId,
  eventTitle,
  tournamentFormat: _tournamentFormat,
  initialTeamsPublished,
  initialDrawPublished,
  onSaved,
}: AdminEventTournamentPanelProps) {
  void _tournamentFormat;
  const { showAlert } = useAlert();
  const location = useLocation();
  const teamsSwitchId = useId();
  const drawSwitchId = useId();
  const drawSectionRef = useRef<HTMLDivElement | null>(null);

  const [teamsPublished, setTeamsPublished] = useState(initialTeamsPublished);
  const [drawPublished, setDrawPublished] = useState(initialDrawPublished);
  const [savingTeams, setSavingTeams] = useState(false);
  const [savingDraw, setSavingDraw] = useState(false);

  const [teams, setTeams] = useState<TournamentTeamApi[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);

  useEffect(() => {
    setTeamsPublished(initialTeamsPublished);
  }, [initialTeamsPublished]);

  useEffect(() => {
    setDrawPublished(initialDrawPublished);
  }, [initialDrawPublished]);

  const loadTeams = useCallback(async () => {
    setTeamsLoading(true);
    try {
      const res = await api.get<{ teams: TournamentTeamApi[] }>(`/events/${eventId}/tournament-teams`);
      setTeams(Array.isArray(res.data?.teams) ? res.data.teams : []);
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to load teams'), 'error');
      setTeams([]);
    } finally {
      setTeamsLoading(false);
    }
  }, [eventId, showAlert]);

  useEffect(() => {
    void loadTeams();
  }, [loadTeams]);

  const sortedTeams = useMemo(
    () => [...teams].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
    [teams],
  );

  const persistTeams = async (next: boolean) => {
    setSavingTeams(true);
    try {
      await api.patch(`/events/${eventId}`, { tournamentTeamsPublished: next });
      setTeamsPublished(next);
      onSaved?.(next, drawPublished);
      showAlert(next ? 'Teams published' : 'Teams unpublished', 'success');
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to update teams publish setting'), 'error');
    } finally {
      setSavingTeams(false);
    }
  };

  const persistDraw = async (next: boolean) => {
    setSavingDraw(true);
    try {
      await api.patch(`/events/${eventId}`, { tournamentDrawPublished: next });
      setDrawPublished(next);
      onSaved?.(teamsPublished, next);
      showAlert(next ? 'Draw published' : 'Draw unpublished', 'success');
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to update draw publish setting'), 'error');
    } finally {
      setSavingDraw(false);
    }
  };

  useLayoutEffect(() => {
    if (!isDrawWorkspaceHash(location.hash)) return;
    drawSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash]);

  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-8">
      <FormSection
        title="Public teams list"
        description="Confirmed registrations are the tournament teams. Publishing shows them on the public event page."
        surface="panel"
      >
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            id={teamsSwitchId}
            role="switch"
            aria-checked={teamsPublished}
            disabled={savingTeams}
            onClick={() => void persistTeams(!teamsPublished)}
            className={switchTrackClass(teamsPublished, savingTeams)}
          >
            <span className={switchThumbClass(teamsPublished)} aria-hidden />
          </button>
          <label htmlFor={teamsSwitchId} className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
            Publish teams on public event page
          </label>
          {savingTeams ? (
            <span className="text-sm text-gray-500 dark:text-gray-400">Saving…</span>
          ) : null}
          {!teamsLoading && sortedTeams.length > 0 ? (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {sortedTeams.length} confirmed team{sortedTeams.length !== 1 ? 's' : ''}
            </span>
          ) : null}
        </div>
      </FormSection>

      <div ref={drawSectionRef}>
        <FormSection
          title="Draw"
          description="Visual bracket editor and draw graph for this bonspiel. Publishing shows the draw on the public event page."
          surface="panel"
          className="flex min-h-0 flex-1 flex-col space-y-5"
        >
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                id={drawSwitchId}
                role="switch"
                aria-checked={drawPublished}
                disabled={savingDraw}
                onClick={() => void persistDraw(!drawPublished)}
                className={switchTrackClass(drawPublished, savingDraw)}
              >
                <span className={switchThumbClass(drawPublished)} aria-hidden />
              </button>
              <label htmlFor={drawSwitchId} className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                Publish draw on public event page
              </label>
              {savingDraw ? (
                <span className="text-sm text-gray-500 dark:text-gray-400">Saving…</span>
              ) : null}
            </div>
            <Link
              to={`/admin/events/${eventId}/scorekeeper`}
              className="inline-flex items-center justify-center rounded-lg bg-primary-teal-solid px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-teal-solid/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40"
            >
              Open scorekeeper
            </Link>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <AdminTournamentDrawEditor
              eventId={eventId}
              teams={sortedTeams}
              exportTemplateFilenameBase={eventTitle}
            />
          </div>
        </FormSection>
      </div>
    </div>
  );
}
