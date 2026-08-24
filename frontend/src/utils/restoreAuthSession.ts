import {
  isRequiresInstallationError,
  shouldRetrySessionRestore,
} from './authRequestFailure';

export type AccessTokenEnsureResult =
  | { status: 'ok'; accessToken: string }
  | { status: 'unauthenticated' }
  | { status: 'transient' };

export type RestoreAuthSessionResult<TSession> =
  | { status: 'success'; session: TSession }
  | { status: 'unauthenticated' }
  | { status: 'installation' }
  | { status: 'cancelled' };

export const AUTH_RESTORE_INITIAL_RETRY_DELAY_MS = 1_000;
export const AUTH_RESTORE_MAX_RETRY_DELAY_MS = 8_000;

export function nextAuthRestoreRetryDelayMs(
  currentMs: number,
  maxMs = AUTH_RESTORE_MAX_RETRY_DELAY_MS,
): number {
  return Math.min(Math.max(currentMs, 1) * 2, maxMs);
}

/**
 * Restore a stored session, retrying through brief API downtime (deploys,
 * 502/503, network blips) instead of treating those failures as logout.
 */
export async function restoreAuthSession<TSession>(options: {
  ensureAccessToken: () => Promise<AccessTokenEnsureResult>;
  verify: () => Promise<TSession>;
  isCancelled: () => boolean;
  sleep: (ms: number) => Promise<void>;
  initialRetryDelayMs?: number;
  maxRetryDelayMs?: number;
}): Promise<RestoreAuthSessionResult<TSession>> {
  const {
    ensureAccessToken,
    verify,
    isCancelled,
    sleep,
    initialRetryDelayMs = AUTH_RESTORE_INITIAL_RETRY_DELAY_MS,
    maxRetryDelayMs = AUTH_RESTORE_MAX_RETRY_DELAY_MS,
  } = options;

  let retryDelayMs = initialRetryDelayMs;

  while (!isCancelled()) {
    const tokenResult = await ensureAccessToken();
    if (isCancelled()) {
      return { status: 'cancelled' };
    }

    if (tokenResult.status === 'unauthenticated') {
      return { status: 'unauthenticated' };
    }

    if (tokenResult.status === 'transient') {
      await sleep(retryDelayMs);
      retryDelayMs = nextAuthRestoreRetryDelayMs(retryDelayMs, maxRetryDelayMs);
      continue;
    }

    try {
      const session = await verify();
      if (isCancelled()) {
        return { status: 'cancelled' };
      }
      return { status: 'success', session };
    } catch (error: unknown) {
      if (isCancelled()) {
        return { status: 'cancelled' };
      }
      if (isRequiresInstallationError(error)) {
        return { status: 'installation' };
      }
      if (!shouldRetrySessionRestore(error)) {
        return { status: 'unauthenticated' };
      }
      await sleep(retryDelayMs);
      retryDelayMs = nextAuthRestoreRetryDelayMs(retryDelayMs, maxRetryDelayMs);
    }
  }

  return { status: 'cancelled' };
}
