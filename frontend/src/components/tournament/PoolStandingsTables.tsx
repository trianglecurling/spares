import type { ReactNode } from 'react';
import { formatTeamDisplayName } from '../../utils/tournamentDisplay';
import type { PhaseStandings, PoolStandingRow } from '../../utils/tournamentDrawPhases';

type TeamMeta = { teamName: string | null; sortOrder: number };

type PoolStandingsTablesProps = {
  standings: PhaseStandings;
  teamsById: Map<number, TeamMeta>;
  tone?: 'app' | 'public';
  /** Optional custom team cell (e.g. a public team link). */
  renderTeam?: (registrationId: number, name: string) => ReactNode;
  /** Highlight one team's rows (team page). */
  highlightRegistrationId?: number | null;
  /** Only show this pool (team page). */
  onlyPoolId?: string | null;
  showOverall?: boolean;
};

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
}

function formatPercent(p: number | null): string {
  return p == null ? '—' : `${(p * 100).toFixed(1).replace(/\.0$/, '')}%`;
}

export default function PoolStandingsTables({
  standings,
  teamsById,
  tone = 'app',
  renderTeam,
  highlightRegistrationId,
  onlyPoolId,
  showOverall = true,
}: PoolStandingsTablesProps) {
  const { settings } = standings;
  const allRows = standings.overall.rows;
  const showTies = allRows.some((r) => r.ties > 0);
  const showPoints = settings.pointsPossiblePerGame !== 1;
  const showPercent = settings.rankBy === 'percentage';
  const showTiebreak = allRows.some((r) => r.tiebreak != null);
  const poolNameById = new Map(standings.pools.map((p) => [p.pool.id, p.pool.name]));
  const pools = onlyPoolId ? standings.pools.filter((p) => p.pool.id === onlyPoolId) : standings.pools;
  const headingClass =
    tone === 'public'
      ? 'text-base font-semibold text-gray-900'
      : 'text-base font-semibold text-gray-900 dark:text-gray-100';

  const teamName = (id: number) => {
    const t = teamsById.get(id);
    return t ? formatTeamDisplayName(t.teamName, t.sortOrder) : `Team #${id}`;
  };

  const table = (caption: string, rows: PoolStandingRow[], withPool: boolean, key: string) => (
    <section key={key} className="space-y-2">
      <h3 className={headingClass}>{caption}</h3>
      {rows.length === 0 ? (
        <p className={tone === 'public' ? 'text-sm text-gray-600' : 'text-sm text-gray-600 dark:text-gray-400'}>
          No teams yet.
        </p>
      ) : (
        <div className="app-table-shell">
          <table className="app-table">
            <thead className="app-table-head">
              <tr>
                <th scope="col" className="app-table-th w-14">#</th>
                <th scope="col" className="app-table-th">Team</th>
                {withPool ? <th scope="col" className="app-table-th">Pool</th> : null}
                <th scope="col" className="app-table-th text-right">W</th>
                <th scope="col" className="app-table-th text-right">L</th>
                {showTies ? <th scope="col" className="app-table-th text-right">T</th> : null}
                {showPoints ? <th scope="col" className="app-table-th text-right">Points</th> : null}
                {showPercent ? <th scope="col" className="app-table-th text-right">%</th> : null}
                {showTiebreak ? (
                  <th scope="col" className="app-table-th text-right">{settings.tiebreakLabel}</th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-800">
              {rows.map((row) => {
                const name = teamName(row.registrationId);
                const highlighted = highlightRegistrationId === row.registrationId;
                return (
                  <tr key={row.registrationId} className={highlighted ? 'bg-primary-teal/10' : undefined}>
                    <td className="app-table-td whitespace-nowrap tabular-nums">{row.rank}</td>
                    <th scope="row" className="app-table-td text-left font-medium text-gray-900 dark:text-gray-100">
                      {renderTeam ? renderTeam(row.registrationId, name) : name}
                    </th>
                    {withPool ? <td className="app-table-td">{poolNameById.get(row.poolId) ?? '—'}</td> : null}
                    <td className="app-table-td text-right tabular-nums">{row.wins}</td>
                    <td className="app-table-td text-right tabular-nums">{row.losses}</td>
                    {showTies ? <td className="app-table-td text-right tabular-nums">{row.ties}</td> : null}
                    {showPoints ? (
                      <td className="app-table-td text-right tabular-nums">{formatNumber(row.points)}</td>
                    ) : null}
                    {showPercent ? (
                      <td className="app-table-td text-right tabular-nums">{formatPercent(row.percentage)}</td>
                    ) : null}
                    {showTiebreak ? (
                      <td className="app-table-td text-right tabular-nums">
                        {row.tiebreak == null ? '—' : formatNumber(row.tiebreak)}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  return (
    <div className="space-y-6">
      {pools.length > 1 || onlyPoolId ? (
        <div className="grid gap-6 xl:grid-cols-2">
          {pools.map((p) => table(p.pool.name, p.rows, false, p.pool.id))}
        </div>
      ) : (
        pools.map((p) => table(p.pool.name, p.rows, false, p.pool.id))
      )}
      {showOverall && standings.pools.length > 1 ? table('Overall', allRows, true, '__overall') : null}
    </div>
  );
}
