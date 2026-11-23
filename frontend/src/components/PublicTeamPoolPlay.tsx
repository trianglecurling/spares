import { useMemo } from 'react';
import PoolStandingsTables from './tournament/PoolStandingsTables';
import type { PublicTournamentDrawTeamRef } from './PublicTournamentDrawBracket';
import type { TournamentDrawState } from '../utils/tournamentDrawModel';
import { computePhaseStandings, gamesForPhase, phasesInOrder } from '../utils/tournamentDrawPhases';
import { outcomeFromResult } from '../utils/tournamentDrawResult';
import { normalizeDrawState, resolveResultsTableSideLabel } from '../utils/tournamentDrawRouting';
import { formatDrawBlockOptionLabel } from '../utils/tournamentDrawSchedule';
import { resolveGameSlotRegistrationId } from '../../../backend/src/utils/tournamentPoolStandings';

type PublicTeamPoolPlayProps = {
  draw: TournamentDrawState;
  teamId: number;
  teamsById: Map<number, PublicTournamentDrawTeamRef>;
};

/** The team's pool standings and pool games, for each pool phase it plays in. */
export default function PublicTeamPoolPlay({ draw: rawDraw, teamId, teamsById }: PublicTeamPoolPlayProps) {
  const draw = useMemo(() => normalizeDrawState(rawDraw), [rawDraw]);
  const sections = useMemo(() => {
    return phasesInOrder(draw)
      .filter((p) => p.kind === 'pool')
      .map((phase) => {
        const standings = computePhaseStandings(draw, phase.id);
        const row = standings?.overall.rows.find((r) => r.registrationId === teamId);
        const games = gamesForPhase(draw, phase.id).filter((g) =>
          [0, 1].some((i) => resolveGameSlotRegistrationId(draw, g, i) === teamId),
        );
        return { phase, standings, poolId: row?.poolId ?? null, games };
      })
      .filter((s) => s.standings && s.poolId);
  }, [draw, teamId]);

  if (sections.length === 0) return null;

  return (
    <div className="shrink-0 w-full max-w-6xl mx-auto px-4 sm:px-6 pb-8 space-y-8">
      {sections.map(({ phase, standings, poolId, games }) => (
        <section key={phase.id} className="space-y-4" aria-labelledby={`team-pool-${phase.id}`}>
          <h2 id={`team-pool-${phase.id}`} className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            {phase.name}
          </h2>
          <PoolStandingsTables
            standings={standings!}
            teamsById={teamsById}
            onlyPoolId={poolId}
            highlightRegistrationId={teamId}
            showOverall={false}
            tone="public"
          />
          {games.length > 0 ? (
            <ul className="divide-y divide-gray-200 rounded-xl border border-gray-200 text-sm dark:divide-gray-700 dark:border-gray-700">
              {games.map((g) => {
                const mySlot = resolveGameSlotRegistrationId(draw, g, 0) === teamId ? 0 : 1;
                const opponent = resolveResultsTableSideLabel(draw, g, mySlot === 0 ? 1 : 0, teamsById);
                const outcome = outcomeFromResult(g);
                const result =
                  outcome == null
                    ? null
                    : outcome === 'tie'
                      ? 'Tie'
                      : (outcome === 'slot0') === (mySlot === 0)
                        ? 'Won'
                        : 'Lost';
                const block = draw.drawBlocks.find((b) => b.id === g.schedule?.drawBlockId);
                return (
                  <li key={g.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
                    <span className="text-gray-900 dark:text-gray-100">
                      vs. <span className="font-medium">{opponent}</span>
                    </span>
                    <span className="text-gray-600 dark:text-gray-400">
                      {[block ? formatDrawBlockOptionLabel(block) : null, g.schedule?.sheetLabel]
                        .filter(Boolean)
                        .join(' · ')}
                      {result ? (
                        <span className="ml-3 font-semibold text-gray-900 dark:text-gray-100">{result}</span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      ))}
    </div>
  );
}
