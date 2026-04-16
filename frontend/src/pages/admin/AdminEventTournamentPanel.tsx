import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import Button from '../../components/Button';
import ChoiceInput, { type ChoiceOption } from '../../components/ChoiceInput';
import DataTable from '../../components/table/DataTable';
import type { DataTableColumn } from '../../components/table/tableTypes';
import FormSection from '../../components/FormSection';
import InlineStateMessage from '../../components/InlineStateMessage';
import api, { formatApiError } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import {
  formatPositionCell,
  formatTeamDisplayName,
  foursTableLegendText,
  slotLabel,
  tableSlotsForFormat,
  type TournamentFormat,
} from '../../utils/tournamentDisplay';
import AdminEventTournamentTeamModal, { type TournamentTeamApi } from './AdminEventTournamentTeamModal';

type AdminEventTournamentPanelProps = {
  eventId: number;
  initialTournamentFormat: TournamentFormat | null;
  onTournamentFormatChange?: (format: TournamentFormat | null) => void;
  initialTeamsPublished: boolean;
  initialDrawPublished: boolean;
  onSaved?: (teamsPublished: boolean, drawPublished: boolean) => void;
};

const TOURNAMENT_FORMAT_OPTIONS: ChoiceOption<string>[] = [
  { value: '', label: 'Select format…' },
  { value: 'fours', label: 'Fours' },
  { value: 'doubles', label: 'Doubles' },
];

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
  initialTournamentFormat,
  onTournamentFormatChange,
  initialTeamsPublished,
  initialDrawPublished,
  onSaved,
}: AdminEventTournamentPanelProps) {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const teamsSwitchId = useId();
  const drawSwitchId = useId();
  const formatInputId = useId();

  const [tournamentFormat, setTournamentFormat] = useState<TournamentFormat | null>(initialTournamentFormat);
  const [savingFormat, setSavingFormat] = useState(false);

  const [teamsPublished, setTeamsPublished] = useState(initialTeamsPublished);
  const [drawPublished, setDrawPublished] = useState(initialDrawPublished);
  const [savingTeams, setSavingTeams] = useState(false);
  const [savingDraw, setSavingDraw] = useState(false);

  const [teams, setTeams] = useState<TournamentTeamApi[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<TournamentTeamApi | null>(null);

  useEffect(() => {
    setTournamentFormat(initialTournamentFormat);
  }, [eventId, initialTournamentFormat]);

  useEffect(() => {
    setTeamsPublished(initialTeamsPublished);
    setDrawPublished(initialDrawPublished);
  }, [eventId, initialTeamsPublished, initialDrawPublished]);

  const loadTeams = useCallback(() => {
    setTeamsLoading(true);
    setTeamsError(null);
    api
      .get<{ teams: TournamentTeamApi[] }>(`/events/${eventId}/tournament-teams`)
      .then((res) => setTeams(res.data?.teams ?? []))
      .catch((err) => setTeamsError(formatApiError(err, 'Failed to load teams')))
      .finally(() => setTeamsLoading(false));
  }, [eventId]);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  const persistFormat = async (raw: string) => {
    const next: TournamentFormat | null =
      raw === 'fours' || raw === 'doubles' ? raw : null;
    if (next === tournamentFormat) return;
    setSavingFormat(true);
    const prev = tournamentFormat;
    setTournamentFormat(next);
    try {
      await api.patch(`/events/${eventId}`, { tournamentFormat: next });
      onTournamentFormatChange?.(next);
    } catch (err) {
      setTournamentFormat(prev);
      showAlert(formatApiError(err, 'Failed to update tournament format'), 'error');
    } finally {
      setSavingFormat(false);
    }
  };

  const persistTeams = async (next: boolean) => {
    if (savingTeams) return;
    const prev = teamsPublished;
    setTeamsPublished(next);
    setSavingTeams(true);
    try {
      await api.patch(`/events/${eventId}`, { tournamentTeamsPublished: next });
      onSaved?.(next, drawPublished);
    } catch (err) {
      setTeamsPublished(prev);
      showAlert(formatApiError(err, 'Failed to update teams visibility'), 'error');
    } finally {
      setSavingTeams(false);
    }
  };

  const persistDraw = async (next: boolean) => {
    if (savingDraw) return;
    const prev = drawPublished;
    setDrawPublished(next);
    setSavingDraw(true);
    try {
      await api.patch(`/events/${eventId}`, { tournamentDrawPublished: next });
      onSaved?.(teamsPublished, next);
    } catch (err) {
      setDrawPublished(prev);
      showAlert(formatApiError(err, 'Failed to update draw visibility'), 'error');
    } finally {
      setSavingDraw(false);
    }
  };

  const sortedTeams = useMemo(
    () => [...teams].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
    [teams],
  );

  const adminFoursLegend = useMemo(() => {
    if (tournamentFormat !== 'fours' || sortedTeams.length === 0) return null;
    return foursTableLegendText(sortedTeams);
  }, [tournamentFormat, sortedTeams]);

  const teamColumns = useMemo((): Array<DataTableColumn<TournamentTeamApi, 'team'>> => {
    if (!tournamentFormat) {
      return [
        { id: 'team', header: 'Team', sortable: false, sortKey: 'team', renderCell: () => '' },
      ];
    }
    const fmt = tournamentFormat;
    const positionCols: Array<DataTableColumn<TournamentTeamApi, 'team'>> = tableSlotsForFormat(fmt).map(
      (slotCode) => ({
        id: `pos-${slotCode}`,
        header: slotLabel(fmt, slotCode),
        sortable: false,
        sortKey: 'team',
        cellClassName: 'text-sm text-gray-700 dark:text-gray-300',
        renderCell: (t) =>
          formatPositionCell(fmt, t.roster, slotCode, t.viceSlotCode, t.skipSlotCode),
      }),
    );
    return [
      {
        id: 'team',
        header: 'Team',
        sortable: false,
        sortKey: 'team',
        renderCell: (t) => (
          <span className="font-medium text-gray-900 dark:text-gray-100">
            {formatTeamDisplayName(t.teamName, t.sortOrder)}
          </span>
        ),
      },
      {
        id: 'club',
        header: 'Home club',
        sortable: false,
        sortKey: 'team',
        cellClassName: 'text-gray-600 dark:text-gray-400',
        renderCell: (t) => t.homeClub?.trim() || '—',
      },
      ...positionCols,
    ];
  }, [tournamentFormat]);

  const handleDeleteTeam = async (t: TournamentTeamApi) => {
    const label = formatTeamDisplayName(t.teamName, t.sortOrder);
    const ok = await confirm({
      title: 'Delete team',
      message: `Remove ${label} from this tournament?`,
    });
    if (!ok) return;
    try {
      await api.delete(`/events/${eventId}/tournament-teams/${t.id}`);
      showAlert('Team removed', 'success');
      loadTeams();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to delete team'), 'error');
    }
  };

  const formatSelectValue = tournamentFormat ?? '';

  return (
    <div className="space-y-8">
      <FormSection
        title="Tournament format"
        description="Choose whether this bonspiel uses fours or doubles teams. You cannot change this while any teams are entered—delete all teams first."
        surface="panel"
      >
        <div className="flex flex-wrap items-center gap-3 max-w-md">
          <ChoiceInput<string>
            inputId={formatInputId}
            options={TOURNAMENT_FORMAT_OPTIONS}
            value={formatSelectValue}
            onChange={(next) => {
              if (next != null && !Array.isArray(next)) void persistFormat(next);
            }}
            listboxLabel="Tournament format"
            disabled={savingFormat}
          />
          {savingFormat ? (
            <span className="text-sm text-gray-500 dark:text-gray-400">Saving…</span>
          ) : null}
        </div>
      </FormSection>

      <FormSection
        title="Teams"
        description="Roster and team management for this bonspiel. Publishing shows the teams list on the public event page when the event type is Bonspiel."
        surface="panel"
      >
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <button
            type="button"
            id={teamsSwitchId}
            role="switch"
            aria-checked={teamsPublished}
            disabled={savingTeams}
            onClick={() => persistTeams(!teamsPublished)}
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
        </div>

        {!tournamentFormat ? (
          <InlineStateMessage
            tone="neutral"
            title="Select a tournament format"
            description="Choose fours or doubles above before you can add teams."
          />
        ) : (
          <>
            <div className="flex flex-wrap justify-end gap-2 mb-3">
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  setEditingTeam(null);
                  setTeamModalOpen(true);
                }}
              >
                Add team
              </Button>
            </div>
            <DataTable<TournamentTeamApi, 'team', number>
              rows={sortedTeams}
              rowKey={(t) => t.id}
              columns={teamColumns}
              loading={teamsLoading}
              error={teamsError ? <span className="text-red-600 dark:text-red-400">{teamsError}</span> : undefined}
              emptyState={
                <InlineStateMessage
                  tone="neutral"
                  title="No teams yet"
                  description="Add teams to build your tournament roster."
                />
              }
              actions={{
                widthClassName: 'w-[9rem]',
                renderActions: (t) => (
                  <div className="flex flex-wrap gap-2 justify-end">
                    <button
                      type="button"
                      className="text-primary-teal hover:underline text-sm font-medium"
                      onClick={() => {
                        setEditingTeam(t);
                        setTeamModalOpen(true);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-red-600 hover:underline dark:text-red-400 text-sm font-medium"
                      onClick={() => handleDeleteTeam(t)}
                    >
                      Delete
                    </button>
                  </div>
                ),
              }}
              shellClassName="overflow-x-auto"
            />
            {adminFoursLegend ? (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">{adminFoursLegend}</p>
            ) : null}
          </>
        )}
      </FormSection>

      <FormSection
        title="Draw"
        description="Draw schedule for this bonspiel. Publishing shows the draw on the public event page when the event type is Bonspiel."
        surface="panel"
      >
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            id={drawSwitchId}
            role="switch"
            aria-checked={drawPublished}
            disabled={savingDraw}
            onClick={() => persistDraw(!drawPublished)}
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
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-4">
          Draw tools will be available here in a later update.
        </p>
      </FormSection>

      {tournamentFormat ? (
        <AdminEventTournamentTeamModal
          isOpen={teamModalOpen}
          onClose={() => setTeamModalOpen(false)}
          eventId={eventId}
          format={tournamentFormat}
          team={editingTeam}
          onSaved={loadTeams}
        />
      ) : null}
    </div>
  );
}
