import { generateAllMatchups } from './generateMatchups';
import { assignAndOptimize } from './assignSlots';
import type { WorkerInMessage, WorkerOutMessage, ProgressUpdate, ScheduleInput } from './types';

function postMsg(msg: WorkerOutMessage) {
  self.postMessage(msg);
}

function reportProgress(update: ProgressUpdate) {
  postMsg({ type: 'progress', payload: update });
}

function generate(input: ScheduleInput) {
  try {
    reportProgress({ phase: 'Generating matchups', percent: 0, message: 'Building round-robin pairings...' });

    const rounds = generateAllMatchups(input.strategies, input.teams);

    if (rounds.length === 0) {
      postMsg({
        type: 'complete',
        payload: {
          games: [],
          unschedulable: [],
          teamStats: [],
          warnings: [{ severity: 'warning', message: 'No matchups generated. Check strategies and team counts.' }],
          totalScore: 0,
        },
      });
      return;
    }

    const totalMatchups = rounds.reduce((s, r) => s + r.matchups.length, 0);
    reportProgress({
      phase: 'Generating matchups',
      percent: 10,
      message: `${totalMatchups} matchups in ${rounds.length} rounds`,
    });

    const teamIds = input.teams.map((t) => t.id);
    const timeBudget = input.optimizationTimeBudgetMs ?? 30_000;
    const result = assignAndOptimize(
      rounds,
      input.drawSlots,
      input.strategies,
      input.byeRequests,
      teamIds,
      input.seed,
      timeBudget,
      reportProgress,
    );

    postMsg({ type: 'complete', payload: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error during schedule generation.';
    postMsg({ type: 'error', message });
  }
}

self.addEventListener('message', (event: MessageEvent<WorkerInMessage>) => {
  if (event.data.type === 'generate') {
    generate(event.data.payload);
  }
});
