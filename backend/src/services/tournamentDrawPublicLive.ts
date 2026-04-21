/**
 * In-memory pub/sub for public tournament draw updates (SSE).
 * Single-process only; multiple app instances would need a shared bus.
 */

const listeners = new Map<number, Set<(sseChunk: string) => void>>();

export function subscribeTournamentDrawLive(
  eventId: number,
  send: (sseChunk: string) => void,
): () => void {
  let bucket = listeners.get(eventId);
  if (!bucket) {
    bucket = new Set();
    listeners.set(eventId, bucket);
  }
  bucket.add(send);
  return () => {
    bucket!.delete(send);
    if (bucket!.size === 0) {
      listeners.delete(eventId);
    }
  };
}

/** Notify all SSE clients watching this event’s public draw to refetch via HTTP. */
export function broadcastTournamentDrawUpdated(eventId: number): void {
  const bucket = listeners.get(eventId);
  if (!bucket || bucket.size === 0) return;

  const payload = JSON.stringify({
    type: 'tournament_draw_updated',
    eventId,
    updatedAt: new Date().toISOString(),
  });
  const chunk = `data: ${payload}\n\n`;
  for (const fn of bucket) {
    try {
      fn(chunk);
    } catch {
      // Subscriber stream may be closed; ignore.
    }
  }
}
