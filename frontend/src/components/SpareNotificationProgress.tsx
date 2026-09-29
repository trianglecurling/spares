type PhaseCounts = { total: number; notified: number };

export type SpareNotificationPhases = {
  bye: PhaseCounts;
  general: PhaseCounts & { startsAt: string | null };
};

type PhaseState = 'done' | 'in_progress' | 'waiting';

const badgeClasses: Record<PhaseState, string> = {
  done: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
  in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  waiting: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
};

const badgeLabels: Record<PhaseState, string> = {
  done: 'Done',
  in_progress: 'In progress',
  waiting: 'Waiting',
};

function phaseState(counts: PhaseCounts): PhaseState {
  if (counts.total > 0 && counts.notified >= counts.total) return 'done';
  return counts.notified > 0 ? 'in_progress' : 'waiting';
}

export function formatStartsIn(startsAt: string, now: Date = new Date()): string {
  const minutes = Math.ceil((new Date(startsAt).getTime() - now.getTime()) / 60_000);
  if (!Number.isFinite(minutes) || minutes <= 1) return 'Starting in less than a minute';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts = [hours > 0 ? `${hours} hr` : null, rest > 0 ? `${rest} min` : null].filter(Boolean);
  return `Starting in ${parts.join(' ')}`;
}

function PhaseRow({ label, detail, state }: { label: string; detail: string; state: PhaseState }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <span>
        <span className="font-medium">{label}:</span> {detail}
      </span>
      <span
        className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${badgeClasses[state]}`}
      >
        {badgeLabels[state]}
      </span>
    </li>
  );
}

type SpareNotificationProgressProps = {
  phases: SpareNotificationPhases;
  paused: boolean;
};

/** Two-phase progress for a public request: players on bye first, then everyone else. */
export default function SpareNotificationProgress({ phases, paused }: SpareNotificationProgressProps) {
  const { bye, general } = phases;
  const byeState = phaseState(bye);
  const generalState = phaseState(general);
  const hasByePhase = bye.total > 0;

  let generalDetail = `${general.notified} of ${general.total} members notified`;
  if (generalState === 'waiting') {
    if (general.startsAt) {
      generalDetail = `${formatStartsIn(general.startsAt)} (${general.total} members)`;
    } else if (hasByePhase && byeState !== 'done') {
      generalDetail = `Starts after players on bye are notified (${general.total} members)`;
    }
  }

  return (
    <div className="text-sm text-blue-800 dark:text-blue-300">
      <p className="font-medium">
        Notifications in progress
        {paused ? (
          <span className="ml-2 font-semibold text-orange-600 dark:text-orange-400">(Paused)</span>
        ) : null}
      </p>
      <ol className="mt-2 space-y-1.5">
        {hasByePhase ? (
          <PhaseRow
            label="Players on bye"
            detail={`${bye.notified} of ${bye.total} notified`}
            state={byeState}
          />
        ) : null}
        {general.total > 0 ? (
          <PhaseRow
            label={hasByePhase ? 'Everyone else' : 'Members'}
            detail={generalDetail}
            state={generalState}
          />
        ) : null}
      </ol>
    </div>
  );
}
