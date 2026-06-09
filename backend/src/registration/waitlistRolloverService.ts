export class WaitlistRolloverValidationError extends Error {
  constructor(public details: Record<string, string>) {
    super('Waitlist rollover validation failed');
  }
}

export type RollWaitlistForwardInput = {
  fromLeagueId: number;
  toLeagueId?: number;
  actorMemberId?: number | null;
  reason?: string | null;
};

/** Waitlists are first-class entities attached to leagues; manual rollover is no longer required. */
export async function rollWaitlistForward(_input: RollWaitlistForwardInput): Promise<{ rolledEntryIds: number[] }> {
  return { rolledEntryIds: [] };
}
