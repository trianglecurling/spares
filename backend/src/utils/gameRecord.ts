export type GameOutcome = 'win' | 'loss' | 'tie';

export type GameRecord = {
  gamesPlayed: number;
  wins: number;
  losses: number;
  ties: number;
};

export type StandingSums = {
  values: number[];
  gamesPlayed: number;
};

export type GameWithResultValues = {
  team1_id: number;
  team2_id: number;
  team1_values: number[];
  team2_values: number[];
};

export function hasRecordedResult(team1Values: number[], team2Values: number[]): boolean {
  return team1Values.length > 0 || team2Values.length > 0;
}

/**
 * W/L/T from the first recorded tiebreaker value.
 * Returns null when neither side has a result so scheduled games are not counted as 0–0 ties.
 */
export function outcomeFromFirstTiebreaker(
  myValues: number[],
  oppValues: number[]
): GameOutcome | null {
  if (!hasRecordedResult(myValues, oppValues)) return null;
  const myVal = myValues[0] ?? 0;
  const oppVal = oppValues[0] ?? 0;
  if (myVal > oppVal) return 'win';
  if (myVal < oppVal) return 'loss';
  return 'tie';
}

export function accumulateStandingSums(games: GameWithResultValues[]): Map<number, StandingSums> {
  const teamSums = new Map<number, StandingSums>();
  for (const game of games) {
    if (!hasRecordedResult(game.team1_values, game.team2_values)) continue;
    const maxOrder = Math.max(game.team1_values.length, game.team2_values.length);
    for (const teamId of [game.team1_id, game.team2_id]) {
      if (!teamSums.has(teamId)) {
        teamSums.set(teamId, { values: [], gamesPlayed: 0 });
      }
    }
    const team1 = teamSums.get(game.team1_id)!;
    const team2 = teamSums.get(game.team2_id)!;
    for (let order = 0; order < maxOrder; order++) {
      while (team1.values.length <= order) team1.values.push(0);
      while (team2.values.length <= order) team2.values.push(0);
      team1.values[order] = (team1.values[order] ?? 0) + (game.team1_values[order] ?? 0);
      team2.values[order] = (team2.values[order] ?? 0) + (game.team2_values[order] ?? 0);
    }
    team1.gamesPlayed++;
    team2.gamesPlayed++;
  }
  return teamSums;
}

export function tallyTeamRecord(
  teamId: number,
  games: Array<{ id: number; team1_id: number; team2_id: number }>,
  resultsByGame: Map<number, Map<number, number[]>>
): GameRecord {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const game of games) {
    const team1Values = resultsByGame.get(game.id)?.get(game.team1_id) ?? [];
    const team2Values = resultsByGame.get(game.id)?.get(game.team2_id) ?? [];
    const myValues = game.team1_id === teamId ? team1Values : team2Values;
    const oppValues = game.team1_id === teamId ? team2Values : team1Values;
    const outcome = outcomeFromFirstTiebreaker(myValues, oppValues);
    if (outcome === 'win') wins++;
    else if (outcome === 'loss') losses++;
    else if (outcome === 'tie') ties++;
  }
  return { gamesPlayed: wins + losses + ties, wins, losses, ties };
}
