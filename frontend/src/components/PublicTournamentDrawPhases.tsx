import { Fragment, useMemo, useState, type RefObject } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageTabs from './PageTabs';
import PublicStateCard from './PublicStateCard';
import PublicTeamRosterDialog from './PublicTeamRosterDialog';
import PublicTournamentDrawBracket, { type PublicTournamentDrawTeamRef } from './PublicTournamentDrawBracket';
import PoolStandingsTables from './tournament/PoolStandingsTables';
import type { TournamentFormat } from '../utils/tournamentDisplay';
import type { TournamentDrawState, TournamentGameNode } from '../utils/tournamentDrawModel';
import { computePhaseStandings, gamesForPhase, phasesInOrder } from '../utils/tournamentDrawPhases';
import { outcomeFromResult, sumEnds } from '../utils/tournamentDrawResult';
import { normalizeDrawState, resolveResultsTableSideLabel } from '../utils/tournamentDrawRouting';
import { formatDrawBlockOptionLabel } from '../utils/tournamentDrawSchedule';

type PublicTournamentDrawPhasesProps = {
  draw: TournamentDrawState;
  teamsById: Map<number, PublicTournamentDrawTeamRef>;
  title: string;
  filenameBase: string;
  alignContentColumnRef?: RefObject<HTMLElement | null>;
  tournamentFormat?: TournamentFormat;
};

/** Latest phase with any recorded result, else the first phase. */
function defaultPhaseId(draw: TournamentDrawState): string | null {
  const phases = phasesInOrder(draw);
  const withResults = phases.filter((p) =>
    Object.values(draw.games).some((g) => g.phaseId === p.id && (g.result != null || g.standing != null)),
  );
  return (withResults[withResults.length - 1] ?? phases[0])?.id ?? null;
}

export default function PublicTournamentDrawPhases({
  draw: rawDraw,
  teamsById,
  title,
  filenameBase,
  alignContentColumnRef,
  tournamentFormat = 'fours',
}: PublicTournamentDrawPhasesProps) {
  const draw = useMemo(() => normalizeDrawState(rawDraw), [rawDraw]);
  const phases = useMemo(() => phasesInOrder(draw), [draw]);
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('phase');
  const active = phases.find((p) => p.id === requested) ?? phases.find((p) => p.id === defaultPhaseId(draw));

  const bracket = (phaseId: string | null) => (
    <PublicTournamentDrawBracket
      draw={draw}
      phaseId={phaseId}
      teamsById={teamsById}
      title={title}
      filenameBase={filenameBase}
      alignContentColumnRef={alignContentColumnRef}
      tournamentFormat={tournamentFormat}
    />
  );

  if (!active) return null;
  if (phases.length === 1 && active.kind === 'bracket') return bracket(active.id);

  return (
    <div className="flex flex-1 min-h-0 flex-col w-full min-w-0">
      {phases.length > 1 ? (
        <div className="shrink-0 max-w-6xl mx-auto w-full px-4 sm:px-6">
          <PageTabs
            ariaLabel="Tournament phases"
            className="!mb-4"
            items={phases.map((p) => ({
              key: p.id,
              label: p.name,
              isActive: p.id === active.id,
              onClick: () =>
                setSearchParams(
                  (prev) => {
                    const next = new URLSearchParams(prev);
                    next.set('phase', p.id);
                    return next;
                  },
                  { replace: true },
                ),
            }))}
          />
        </div>
      ) : null}
      {active.kind === 'bracket' ? (
        bracket(active.id)
      ) : (
        <PublicPoolPhase draw={draw} phaseId={active.id} teamsById={teamsById} tournamentFormat={tournamentFormat} />
      )}
    </div>
  );
}

function scoreLine(game: TournamentGameNode): [string, string] | null {
  const r = game.result;
  if (r?.entryKind === 'final_score') return [String(r.finalScores[0]), String(r.finalScores[1])];
  if (r?.entryKind === 'ends' && r.ends.side0.length > 0) {
    return [String(sumEnds(r.ends.side0)), String(sumEnds(r.ends.side1))];
  }
  return null;
}

function PublicPoolPhase({
  draw,
  phaseId,
  teamsById,
  tournamentFormat,
}: {
  draw: TournamentDrawState;
  phaseId: string;
  teamsById: Map<number, PublicTournamentDrawTeamRef>;
  tournamentFormat: TournamentFormat;
}) {
  const [openTeamId, setOpenTeamId] = useState<number | null>(null);
  const standings = useMemo(() => computePhaseStandings(draw, phaseId), [draw, phaseId]);
  const games = useMemo(() => gamesForPhase(draw, phaseId), [draw, phaseId]);
  const poolNameById = useMemo(() => new Map(draw.pools.map((p) => [p.id, p.name])), [draw.pools]);
  const groups = useMemo(() => {
    const blocks = [...draw.drawBlocks].sort((a, b) => a.order - b.order);
    const out: { key: string; label: string; games: TournamentGameNode[] }[] = [];
    for (const b of blocks) {
      const list = games.filter((g) => g.schedule?.drawBlockId === b.id);
      if (list.length) out.push({ key: b.id, label: formatDrawBlockOptionLabel(b), games: list });
    }
    const rest = games.filter((g) => !g.schedule?.drawBlockId || !blocks.some((b) => b.id === g.schedule?.drawBlockId));
    if (rest.length) out.push({ key: '__none', label: 'Unscheduled', games: rest });
    return out;
  }, [draw.drawBlocks, games]);

  const renderTeam = (registrationId: number, name: string) => (
    <button
      type="button"
      className="text-left font-medium text-primary-teal-link hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40"
      onClick={() => setOpenTeamId(registrationId)}
    >
      {name}
    </button>
  );

  return (
    <div className="max-w-6xl mx-auto w-full px-4 sm:px-6 pb-10 space-y-10">
      <section className="space-y-4" aria-labelledby={`standings-${phaseId}`}>
        <h2 id={`standings-${phaseId}`} className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          Standings
        </h2>
        {standings && standings.overall.rows.length > 0 ? (
          <PoolStandingsTables standings={standings} teamsById={teamsById} renderTeam={renderTeam} tone="public" />
        ) : (
          <PublicStateCard title="No standings yet" description="Teams and results will appear here." />
        )}
      </section>
      {games.length > 0 ? (
        <section className="space-y-4" aria-labelledby={`games-${phaseId}`}>
          <h2 id={`games-${phaseId}`} className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Games
          </h2>
          <div className="app-table-shell">
            <table className="app-table">
              <thead className="app-table-head">
                <tr>
                  <th scope="col" className="app-table-th">Game</th>
                  <th scope="col" className="app-table-th">Pool</th>
                  <th scope="col" className="app-table-th">Sheet</th>
                  <th scope="col" className="app-table-th">Teams</th>
                  <th scope="col" className="app-table-th">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-800">
                {groups.map((group) => (
                  <Fragment key={group.key}>
                    <tr className="bg-gray-50 dark:bg-gray-900/40">
                      <th
                        scope="colgroup"
                        colSpan={5}
                        className="px-4 py-2 text-left text-sm font-semibold text-gray-800 dark:text-gray-200"
                      >
                        {group.label}
                      </th>
                    </tr>
                    {group.games.map((g) => {
                      const outcome = outcomeFromResult(g);
                      const labels = [0, 1].map((i) => resolveResultsTableSideLabel(draw, g, i, teamsById));
                      const scores = scoreLine(g);
                      const sheet = g.schedule?.sheetId != null
                        ? (draw.sheets.find((s) => s.clubSheetId === g.schedule?.sheetId)?.name ?? g.schedule.sheetLabel)
                        : null;
                      const result =
                        outcome == null
                          ? '—'
                          : scores
                            ? `${scores[0]}–${scores[1]}`
                            : outcome === 'tie'
                              ? 'Tie'
                              : `${labels[outcome === 'slot0' ? 0 : 1]} won`;
                      return (
                        <tr key={g.id}>
                          <td className="app-table-td whitespace-nowrap">{g.label}</td>
                          <td className="app-table-td whitespace-nowrap">
                            {g.poolId ? (poolNameById.get(g.poolId) ?? '—') : 'Cross-pool'}
                          </td>
                          <td className="app-table-td whitespace-nowrap">{sheet ?? '—'}</td>
                          <td className="app-table-td">
                            <span className={outcome === 'slot0' ? 'font-semibold text-gray-900 dark:text-gray-100' : undefined}>
                              {labels[0]}
                            </span>
                            <span className="text-gray-500 dark:text-gray-400"> vs. </span>
                            <span className={outcome === 'slot1' ? 'font-semibold text-gray-900 dark:text-gray-100' : undefined}>
                              {labels[1]}
                            </span>
                          </td>
                          <td className="app-table-td whitespace-nowrap tabular-nums">{result}</td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      <PublicTeamRosterDialog
        teamId={openTeamId}
        teamsById={teamsById}
        format={tournamentFormat}
        onClose={() => setOpenTeamId(null)}
      />
    </div>
  );
}
