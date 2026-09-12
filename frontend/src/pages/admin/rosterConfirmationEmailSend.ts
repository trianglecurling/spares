export type RosterConfirmationSendProgress = {
  completed: number;
  total: number;
  sent: number;
  failed: number;
};

export type RosterConfirmationSendJobLike = {
  status: 'running' | 'completed' | 'failed' | string;
  total: number;
  completed: number;
  sent: number;
  failed: number;
  errors: Array<{ memberId: number; memberName: string; error: string }>;
};

export function rosterConfirmationSendProgressFromJob(
  job: RosterConfirmationSendJobLike,
): RosterConfirmationSendProgress {
  return {
    completed: job.completed,
    total: job.total,
    sent: job.sent,
    failed: job.failed,
  };
}

export function rosterConfirmationSendErrorsFromJob(
  job: RosterConfirmationSendJobLike,
): Record<number, string> {
  const next: Record<number, string> = {};
  for (const row of job.errors) {
    if (row.memberId > 0) next[row.memberId] = row.error;
  }
  return next;
}

export function rosterConfirmationSendProgressPercent(progress: RosterConfirmationSendProgress): number {
  if (progress.total <= 0) return 0;
  return Math.min(100, Math.round((progress.completed / progress.total) * 100));
}

export function rosterConfirmationSendProgressLabel(
  progress: RosterConfirmationSendProgress,
  status?: string,
): string {
  if (status === 'failed') return `Stopped after ${progress.completed} of ${progress.total}`;
  if (status === 'completed') return `Sent ${progress.sent} of ${progress.total}`;
  return `Sending ${progress.completed} of ${progress.total}`;
}

export function rosterConfirmationSendJobErrors(job: RosterConfirmationSendJobLike): string[] {
  return job.errors.filter((row) => row.memberId <= 0).map((row) => row.error);
}
