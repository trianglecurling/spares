import { useEffect, useState } from 'react';

/**
 * True only after `condition` has been continuously true for at least `delayMs`.
 * Resets immediately when `condition` becomes false (avoids loading flashes on fast loads).
 */
export function useDelayedTrueWhile(condition: boolean, delayMs: number): boolean {
  const [pastDelay, setPastDelay] = useState(false);

  useEffect(() => {
    if (!condition) {
      setPastDelay(false);
      return;
    }
    const id = window.setTimeout(() => setPastDelay(true), delayMs);
    return () => window.clearTimeout(id);
  }, [condition, delayMs]);

  return condition && pastDelay;
}
