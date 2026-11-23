import { describe, expect, it } from 'bun:test';
import { pickWaitlistOfferSessionId, type WaitlistOfferSessionTransition } from './waitlistOfferSession.js';

const FALL = 1;
const WINTER = 3;
const at = (iso: string) => Date.parse(iso);

const fallClosed: WaitlistOfferSessionTransition[] = [
  { sessionId: FALL, state: 'priority', effectiveAtMs: at('2026-08-20T16:00:00Z') },
  { sessionId: FALL, state: 'open', effectiveAtMs: at('2026-09-04T08:01:00Z') },
  { sessionId: FALL, state: 'closed', effectiveAtMs: at('2026-09-12T05:56:22Z') },
];

describe('pickWaitlistOfferSessionId', () => {
  it('uses the current session when its registration has closed and the next has not opened', () => {
    expect(
      pickWaitlistOfferSessionId({
        sessionIdsNewestFirst: [WINTER, FALL],
        transitions: fallClosed,
        nowMs: at('2026-11-17T14:00:00Z'),
      }),
    ).toBe(FALL);
  });

  it('returns null while registration is open', () => {
    expect(
      pickWaitlistOfferSessionId({
        sessionIdsNewestFirst: [FALL],
        transitions: fallClosed,
        nowMs: at('2026-09-05T12:00:00Z'),
      }),
    ).toBeNull();
  });

  it('returns null when registration has never opened', () => {
    expect(
      pickWaitlistOfferSessionId({
        sessionIdsNewestFirst: [WINTER],
        transitions: [{ sessionId: WINTER, state: 'closed', effectiveAtMs: at('2026-10-01T00:00:00Z') }],
        nowMs: at('2026-11-17T14:00:00Z'),
      }),
    ).toBeNull();
  });

  it('prefers the newest session once its registration has closed', () => {
    expect(
      pickWaitlistOfferSessionId({
        sessionIdsNewestFirst: [WINTER, FALL],
        transitions: [
          ...fallClosed,
          { sessionId: WINTER, state: 'open', effectiveAtMs: at('2026-12-01T00:00:00Z') },
          { sessionId: WINTER, state: 'closed', effectiveAtMs: at('2026-12-10T00:00:00Z') },
        ],
        nowMs: at('2026-12-15T00:00:00Z'),
      }),
    ).toBe(WINTER);
  });

  it('ignores transitions scheduled in the future', () => {
    expect(
      pickWaitlistOfferSessionId({
        sessionIdsNewestFirst: [FALL],
        transitions: fallClosed,
        nowMs: at('2026-09-10T00:00:00Z'),
      }),
    ).toBeNull();
  });
});
