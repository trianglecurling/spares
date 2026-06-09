import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { HiChevronDown } from 'react-icons/hi2';
import Button from '../../components/Button';
import ChoiceInput, { type ChoiceOption } from '../../components/ChoiceInput';
import DataTable from '../../components/table/DataTable';
import type { DataTableColumn } from '../../components/table/tableTypes';
import FormField from '../../components/FormField';
import FormSection from '../../components/FormSection';
import InlineStateMessage from '../../components/InlineStateMessage';
import Modal from '../../components/Modal';
import api, { formatApiError } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import {
  formatPositionCell,
  formatTeamDisplayName,
  foursTableLegendText,
  rosterSlotsForFormat,
  slotLabel,
  tableSlotsForFormat,
  type TournamentFormat,
} from '../../utils/tournamentDisplay';
import AdminEventTournamentTeamModal, { type TournamentTeamApi } from './AdminEventTournamentTeamModal';
import AdminEventTournamentTeamsImportModal from './AdminEventTournamentTeamsImportModal';
import AdminTournamentDrawEditor from './AdminTournamentDrawEditor';

function isDrawWorkspaceHash(hash: string): boolean {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  return raw === 'setup' || raw === 'structure' || raw === 'results';
}

type AdminEventTournamentPanelProps = {
  eventId: number;
  eventTitle: string;
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

function tsvCell(value: string | null | undefined): string {
  const s = value ?? '';
  return String(s).replace(/\r\n/g, ' ').replace(/\n/g, ' ').replace(/\r/g, ' ').replace(/\t/g, ' ');
}

function tournamentTeamsToTsv(format: TournamentFormat, teams: TournamentTeamApi[]): string {
  const slots = rosterSlotsForFormat(format);
  const header = ['Team name', 'Home club', 'Position', 'Player name', 'Email', 'Notes'];
  const sorted = [...teams].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const lines = sorted.flatMap((t) => {
    const teamName = formatTeamDisplayName(t.teamName, t.sortOrder);
    const homeClub = tsvCell(t.homeClub);
    const bySlot = new Map(t.roster.map((r) => [r.slotCode, r]));
    return slots.map((slotCode) => {
      const r = bySlot.get(slotCode);
      return [
        tsvCell(teamName),
        homeClub,
        tsvCell(slotLabel(format, slotCode)),
        tsvCell(r?.playerName),
        tsvCell(r?.email),
        tsvCell(r?.notes),
      ].join('\t');
    });
  });
  return [header.join('\t'), ...lines].join('\n');
}

export default function AdminEventTournamentPanel({
  eventId,
  eventTitle,
  initialTournamentFormat,
  onTournamentFormatChange,
  initialTeamsPublished,
  initialDrawPublished,
  onSaved,
}: AdminEventTournamentPanelProps) {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const location = useLocation();
  const teamsSwitchId = useId();
  const drawSwitchId = useId();
  const formatInputId = useId();
  const drawSectionRef = useRef<HTMLDivElement | null>(null);

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
  const [selectedTeamIds, setSelectedTeamIds] = useState<number[]>([]);
  const [rosterExpanded, setRosterExpanded] = useState(false);
  const [teamsExportModalOpen, setTeamsExportModalOpen] = useState(false);
  const [teamsExportTsv, setTeamsExportTsv] = useState('');
  const [teamsImportModalOpen, setTeamsImportModalOpen] = useState(false);

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

  useEffect(() => {
    setSelectedTeamIds([]);
  }, [eventId]);

  // Scroll Draw into view when opening this panel for an event with #setup|#structure|#results.
  // Depends on eventId only so tab clicks (hash change, same event) do not re-scroll.
  useLayoutEffect(() => {
    if (!isDrawWorkspaceHash(location.hash)) return;
    let cancelled = false;
    let frames = 0;
    const maxFrames = 40;

    const tryScroll = (): boolean => {
      const el = drawSectionRef.current;
      if (!el) return false;
      el.scrollIntoView({ block: 'start', behavior: 'auto' });
      return true;
    };

    const step = () => {
      if (cancelled) return;
      if (tryScroll()) return;
      frames += 1;
      if (frames < maxFrames) {
        requestAnimationFrame(step);
      }
    };

    step();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  useEffect(() => {
    const valid = new Set(teams.map((t) => t.id));
    setSelectedTeamIds((prev) => prev.filter((id) => valid.has(id)));
  }, [teams]);

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

  const handleOpenTeamsExportTsv = () => {
    if (!tournamentFormat) return;
    if (!teams.length) {
      showAlert('No teams to export yet', 'warning');
      return;
    }
    setTeamsExportTsv(tournamentTeamsToTsv(tournamentFormat, teams));
    setTeamsExportModalOpen(true);
  };

  const handleCopyTeamsExportTsv = async () => {
    try {
      await navigator.clipboard.writeText(teamsExportTsv);
      showAlert('TSV copied to clipboard!', 'success');
    } catch (error) {
      console.error('Failed to copy TSV:', error);
      showAlert('Failed to copy TSV', 'error');
    }
  };

  const handleBulkDeleteTeams = async () => {
    if (selectedTeamIds.length === 0) return;
    const rows = sortedTeams.filter((t) => selectedTeamIds.includes(t.id));
    const ok = await confirm({
      title: 'Delete teams',
      message: `Remove ${rows.length} team${rows.length !== 1 ? 's' : ''} from this tournament?`,
    });
    if (!ok) return;
    try {
      await Promise.all(
        selectedTeamIds.map((teamId) => api.delete(`/events/${eventId}/tournament-teams/${teamId}`)),
      );
      showAlert(rows.length === 1 ? 'Team removed' : `${rows.length} teams removed`, 'success');
      setSelectedTeamIds([]);
      loadTeams();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to delete teams'), 'error');
      loadTeams();
    }
  };

  const formatSelectValue = tournamentFormat ?? '';

  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-8">
      <FormSection
        title="Tournament format"
        description="Choose whether this bonspiel uses fours or doubles teams. You cannot change this while any teams are entered—delete all teams first."
        surface="panel"
      >
        <div className="flex flex-wrap items-end gap-3 max-w-md">
          <FormField label="Tournament format" htmlFor={formatInputId} className="min-w-[12rem]">
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
          </FormField>
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
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-gray-900 dark:text-gray-100 bg-gray-50/80 dark:bg-gray-900/40 hover:bg-gray-100/80 dark:hover:bg-gray-800/60 transition-colors"
              aria-expanded={rosterExpanded}
              onClick={() => setRosterExpanded((v) => !v)}
            >
              <HiChevronDown
                className={`h-5 w-5 shrink-0 text-gray-500 dark:text-gray-400 transition-transform ${rosterExpanded ? 'rotate-180' : ''}`}
                aria-hidden
              />
              <span>
                Team roster
                {sortedTeams.length > 0 ? (
                  <span className="font-normal text-gray-600 dark:text-gray-400">
                    {' '}
                    ({sortedTeams.length} team{sortedTeams.length !== 1 ? 's' : ''})
                  </span>
                ) : null}
              </span>
            </button>
            {rosterExpanded ? (
              <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-4 space-y-3">
                <div className="flex flex-wrap justify-end gap-2">
                  {selectedTeamIds.length > 0 ? (
                    <Button type="button" variant="danger" onClick={() => void handleBulkDeleteTeams()}>
                      Delete selected ({selectedTeamIds.length})
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={teamsLoading}
                    onClick={() => setTeamsImportModalOpen(true)}
                  >
                    Import teams…
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={teamsLoading}
                    onClick={handleOpenTeamsExportTsv}
                  >
                    Export teams TSV
                  </Button>
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
                  selection={{
                    selectedIds: selectedTeamIds,
                    onToggleRow: (t, checked) => {
                      setSelectedTeamIds((prev) =>
                        checked ? Array.from(new Set([...prev, t.id])) : prev.filter((id) => id !== t.id),
                      );
                    },
                    onTogglePage: (pageRows, checked) => {
                      const ids = pageRows.map((r) => r.id);
                      setSelectedTeamIds((prev) =>
                        checked ? Array.from(new Set([...prev, ...ids])) : prev.filter((id) => !ids.includes(id)),
                      );
                    },
                    getRowLabel: (t) => formatTeamDisplayName(t.teamName, t.sortOrder),
                  }}
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
                  <p className="text-xs text-gray-500 dark:text-gray-400">{adminFoursLegend}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </FormSection>

      <div ref={drawSectionRef}>
        <FormSection
          title="Draw"
          description="Visual bracket editor and draw graph for this bonspiel. Publishing shows the draw on the public event page when the event type is Bonspiel."
          surface="panel"
          className="flex min-h-0 flex-1 flex-col space-y-5"
        >
          <div className="flex flex-wrap items-center gap-3 mb-6">
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
          <div className="flex min-h-0 flex-1 flex-col">
            <AdminTournamentDrawEditor
              eventId={eventId}
              teams={sortedTeams}
              exportTemplateFilenameBase={eventTitle}
            />
          </div>
        </FormSection>
      </div>

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

      {tournamentFormat ? (
        <AdminEventTournamentTeamsImportModal
          isOpen={teamsImportModalOpen}
          onClose={() => setTeamsImportModalOpen(false)}
          eventId={eventId}
          format={tournamentFormat}
          onImported={loadTeams}
        />
      ) : null}

      <Modal
        isOpen={teamsExportModalOpen}
        onClose={() => setTeamsExportModalOpen(false)}
        title="Export tournament teams (TSV)"
        size="xl"
      >
        <div className="flex flex-col h-full min-h-0 space-y-4">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            Copy and paste this into a spreadsheet (tab-separated values).
          </div>
          <textarea
            className="app-input flex-1 min-h-0 font-mono text-xs"
            value={teamsExportTsv}
            readOnly
          />
          <div className="flex justify-end space-x-3">
            <Button variant="secondary" onClick={() => setTeamsExportModalOpen(false)}>
              Close
            </Button>
            <Button onClick={() => void handleCopyTeamsExportTsv()}>Copy TSV</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
