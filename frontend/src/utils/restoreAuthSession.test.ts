import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { describe, expect, test } from 'bun:test';
import { markTransientAuthFailure } from './authRequestFailure';
import {
  nextAuthRestoreRetryDelayMs,
  restoreAuthSession,
  type AccessTokenEnsureResult,
} from './restoreAuthSession';

function httpError(status: number, data?: unknown): AxiosError {
  const error = new AxiosError(`Request failed with status ${status}`);
  error.response = {
    status,
    statusText: 'Error',
    data,
    headers: {},
    config: {} as InternalAxiosRequestConfig,
  } as AxiosResponse;
  return error;
}

describe('nextAuthRestoreRetryDelayMs', () => {
  test('doubles and caps the delay', () => {
    expect(nextAuthRestoreRetryDelayMs(1_000)).toBe(2_000);
    expect(nextAuthRestoreRetryDelayMs(4_000)).toBe(8_000);
    expect(nextAuthRestoreRetryDelayMs(8_000)).toBe(8_000);
  });
});

describe('restoreAuthSession', () => {
  test('returns the verified session on the first try', async () => {
    const result = await restoreAuthSession({
      ensureAccessToken: async () => ({ status: 'ok', accessToken: 'a' }),
      verify: async () => ({ member: 'ok' }),
      isCancelled: () => false,
      sleep: async () => {},
    });

    expect(result).toEqual({ status: 'success', session: { member: 'ok' } });
  });

  test('retries after API downtime then restores the session', async () => {
    let verifyAttempts = 0;
    const delays: number[] = [];

    const result = await restoreAuthSession({
      ensureAccessToken: async () => ({ status: 'ok', accessToken: 'a' }),
      verify: async () => {
        verifyAttempts += 1;
        if (verifyAttempts < 3) {
          throw httpError(502);
        }
        return { member: 'ok' };
      },
      isCancelled: () => false,
      sleep: async (ms) => {
        delays.push(ms);
      },
      initialRetryDelayMs: 1_000,
    });

    expect(result).toEqual({ status: 'success', session: { member: 'ok' } });
    expect(verifyAttempts).toBe(3);
    expect(delays).toEqual([1_000, 2_000]);
  });

  test('retries when token refresh is down, then succeeds', async () => {
    const tokenResults: AccessTokenEnsureResult[] = [
      { status: 'transient' },
      { status: 'ok', accessToken: 'a' },
    ];

    const result = await restoreAuthSession({
      ensureAccessToken: async () => tokenResults.shift() ?? { status: 'unauthenticated' },
      verify: async () => ({ member: 'ok' }),
      isCancelled: () => false,
      sleep: async () => {},
    });

    expect(result).toEqual({ status: 'success', session: { member: 'ok' } });
  });

  test('logs out when refresh confirms the session is gone', async () => {
    const result = await restoreAuthSession({
      ensureAccessToken: async () => ({ status: 'unauthenticated' }),
      verify: async () => ({ member: 'ok' }),
      isCancelled: () => false,
      sleep: async () => {},
    });

    expect(result).toEqual({ status: 'unauthenticated' });
  });

  test('logs out on a confirmed verify 401', async () => {
    const result = await restoreAuthSession({
      ensureAccessToken: async () => ({ status: 'ok', accessToken: 'a' }),
      verify: async () => {
        throw httpError(401);
      },
      isCancelled: () => false,
      sleep: async () => {},
    });

    expect(result).toEqual({ status: 'unauthenticated' });
  });

  test('retries a 401 when refresh failed because the API was down', async () => {
    let verifyAttempts = 0;

    const result = await restoreAuthSession({
      ensureAccessToken: async () => ({ status: 'ok', accessToken: 'a' }),
      verify: async () => {
        verifyAttempts += 1;
        if (verifyAttempts === 1) {
          const error = httpError(401);
          markTransientAuthFailure(error);
          throw error;
        }
        return { member: 'ok' };
      },
      isCancelled: () => false,
      sleep: async () => {},
    });

    expect(result).toEqual({ status: 'success', session: { member: 'ok' } });
    expect(verifyAttempts).toBe(2);
  });

  test('stops on installation 503 without treating it as logout', async () => {
    const result = await restoreAuthSession({
      ensureAccessToken: async () => ({ status: 'ok', accessToken: 'a' }),
      verify: async () => {
        throw httpError(503, { requiresInstallation: true });
      },
      isCancelled: () => false,
      sleep: async () => {},
    });

    expect(result).toEqual({ status: 'installation' });
  });

  test('stops when cancelled', async () => {
    const result = await restoreAuthSession({
      ensureAccessToken: async () => ({ status: 'ok', accessToken: 'a' }),
      verify: async () => ({ member: 'ok' }),
      isCancelled: () => true,
      sleep: async () => {},
    });

    expect(result).toEqual({ status: 'cancelled' });
  });
});
