export const ROSTER_CONFIRMATION_SEND_BATCH_SIZE = 5;

export type RosterConfirmationSendProgress = {
  completed: number;
  total: number;
  sent: number;
  failed: number;
};

export function rosterConfirmationSendBatches(
  memberIds: number[],
  batchSize = ROSTER_CONFIRMATION_SEND_BATCH_SIZE,
): number[][] {
  const size = Math.max(1, batchSize);
  const batches: number[][] = [];
  for (let i = 0; i < memberIds.length; i += size) {
    batches.push(memberIds.slice(i, i + size));
  }
  return batches;
}

export function rosterConfirmationSendProgressPercent(progress: RosterConfirmationSendProgress): number {
  if (progress.total <= 0) return 0;
  return Math.min(100, Math.round((progress.completed / progress.total) * 100));
}

export function rosterConfirmationSendProgressLabel(progress: RosterConfirmationSendProgress): string {
  return `Sending ${progress.completed} of ${progress.total}`;
}
