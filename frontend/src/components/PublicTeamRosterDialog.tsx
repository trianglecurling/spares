import Modal from './Modal';
import type { PublicTournamentDrawTeamRef } from './PublicTournamentDrawBracket';
import {
  formatTeamDisplayName,
  slotLabel,
  tableSlotsForFormat,
  type TournamentFormat,
} from '../utils/tournamentDisplay';

type Props = {
  teamId: number | null;
  teamsById: Map<number, PublicTournamentDrawTeamRef>;
  format: TournamentFormat;
  onClose: () => void;
};

export default function PublicTeamRosterDialog({ teamId, teamsById, format, onClose }: Props) {
  const team = teamId != null ? teamsById.get(teamId) : undefined;
  const title = team ? formatTeamDisplayName(team.teamName, team.sortOrder) : 'Team';
  const slots = tableSlotsForFormat(format);
  const roster = team?.roster ?? [];
  const extraSlots = roster.filter(
    (row) => !slots.includes(row.slotCode) && !!row.playerName?.trim()
  );
  const vice = team?.viceSlotCode ?? (format === 'fours' ? 'third' : 'player1');
  const skip = team?.skipSlotCode ?? (format === 'fours' ? 'fourth' : 'player2');
  const rows = [...slots.map((slotCode) => ({ slotCode })), ...extraSlots];
  const playerLabel = (slotCode: string) => {
    const raw = roster.find((row) => row.slotCode === slotCode)?.playerName?.trim() || '—';
    if (format !== 'fours' || raw === '—') return raw;
    const notes: string[] = [];
    if (slotCode === skip && skip !== 'fourth') notes.push('skip');
    if (slotCode === vice && vice !== 'third') notes.push('vice');
    return notes.length > 0 ? `${raw} (${notes.join(', ')})` : raw;
  };

  return (
    <Modal isOpen={teamId != null && !!team} onClose={onClose} title={title} size="sm">
      {team ? (
        <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
          <div>
            <p className="font-medium text-gray-900 dark:text-gray-100">Home club</p>
            <p className="mt-1">{team.homeClub?.trim() || '—'}</p>
          </div>
          <div>
            <p className="font-medium text-gray-900 dark:text-gray-100">Roster</p>
            <dl className="mt-2 space-y-2">
              {rows.map((row) => (
                <div key={row.slotCode} className="flex gap-3">
                  <dt className="w-24 shrink-0 text-gray-500 dark:text-gray-400">
                    {slotLabel(format, row.slotCode)}
                  </dt>
                  <dd className="min-w-0 text-gray-900 dark:text-gray-100">{playerLabel(row.slotCode)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
