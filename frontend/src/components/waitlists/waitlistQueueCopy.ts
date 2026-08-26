export const WAITLIST_POSITION_HELP =
  'Your position is based on club tenure (years at this club), with years at another club as a tiebreaker. After staff freeze a waitlist, people already in line keep their places and new joiners line up behind them by tenure. Waitlists are frozen immediately after the priority registration period ends for any session. Your number can change until that freeze, and among people who join after it.';

export const WAITLIST_QUEUE_STAFF_HELP =
  'Unfrozen entries sort live by club tenure, then years at another club. Freezing locks the current order so later joiners cannot pass those rows.';

export function nextFrozenCountAfterMove(input: {
  frozenCount: number;
  activeIndex: number;
  overIndex: number;
  total: number;
}): number {
  let next = input.frozenCount;
  if (input.activeIndex >= input.frozenCount && input.overIndex < input.frozenCount) {
    next += 1;
  } else if (input.activeIndex < input.frozenCount && input.overIndex >= input.frozenCount) {
    next -= 1;
  }
  if (next < 0) return 0;
  if (next > input.total) return input.total;
  return next;
}
