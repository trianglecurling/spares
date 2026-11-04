import { Link } from 'react-router-dom';
import PublicStateCard from './PublicStateCard';
import {
  formatPositionCell,
  formatTeamDisplayName,
  foursTableLegendText,
  slotLabel,
  tableSlotsForFormat,
  type TournamentFormat,
} from '../utils/tournamentDisplay';

export type PublicTournamentTeam = {
  id: number;
  sortOrder: number;
  teamName: string | null;
  homeClub: string | null;
  viceSlotCode: string;
  skipSlotCode: string;
  roster: Array<{ slotCode: string; playerName: string | null }>;
};

type PublicEventTeamsTableProps = {
  eventSlug: string;
  teams: PublicTournamentTeam[];
  format: TournamentFormat | null;
  loading: boolean;
  error: string | null;
  showLoadingCard: boolean;
  linkTeamIds: Set<number> | null;
  specialLinkQuery?: string | null;
};

export default function PublicEventTeamsTable({
  eventSlug,
  teams,
  format,
  loading,
  error,
  showLoadingCard,
  linkTeamIds,
  specialLinkQuery,
}: PublicEventTeamsTableProps) {
  const foursLegend = format === 'fours' && teams.length > 0 ? foursTableLegendText(teams) : null;

  return (
    <div className="public-card p-6 text-gray-700 dark:text-gray-300">
      <h2 className="public-subheading text-xl mb-4">Teams</h2>
      {loading ? (
        showLoadingCard ? (
          <PublicStateCard title="Loading…" description="Please wait." />
        ) : (
          <div className="min-h-[min(24vh,16rem)]" aria-hidden />
        )
      ) : error ? (
        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
      ) : !format ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">No team format is configured yet.</p>
      ) : (
        <div className="overflow-x-auto -mx-2 px-2">
          <table className="min-w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-600 text-left">
                <th className="py-2 pr-4 font-semibold text-gray-900 dark:text-gray-100">Team</th>
                <th className="py-2 pr-4 font-semibold text-gray-900 dark:text-gray-100">Home club</th>
                {tableSlotsForFormat(format).map((slotCode) => (
                  <th
                    key={slotCode}
                    className="py-2 pr-4 font-semibold text-gray-900 dark:text-gray-100 whitespace-nowrap"
                  >
                    {slotLabel(format, slotCode)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...teams]
                .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
                .map((team) => (
                  <tr key={team.id} className="border-b border-gray-100 dark:border-gray-700/80 align-top">
                    <td className="py-3 pr-4 font-medium text-gray-900 dark:text-gray-100">
                      {linkTeamIds?.has(team.id) ? (
                        <Link
                          to={
                            specialLinkQuery
                              ? `/events/${eventSlug}/teams/${team.id}?${new URLSearchParams({ slk: specialLinkQuery }).toString()}`
                              : `/events/${eventSlug}/teams/${team.id}`
                          }
                          className="text-left text-primary-teal-link hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40 rounded"
                        >
                          {formatTeamDisplayName(team.teamName, team.sortOrder)}
                        </Link>
                      ) : (
                        formatTeamDisplayName(team.teamName, team.sortOrder)
                      )}
                    </td>
                    <td className="py-3 pr-4 text-gray-700 dark:text-gray-300">{team.homeClub?.trim() || '—'}</td>
                    {tableSlotsForFormat(format).map((slotCode) => (
                      <td key={slotCode} className="py-3 pr-4 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                        {formatPositionCell(format, team.roster, slotCode, team.viceSlotCode, team.skipSlotCode)}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
          {foursLegend ? <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">{foursLegend}</p> : null}
          {teams.length === 0 ? (
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-4">No teams listed yet.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
