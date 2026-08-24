import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { describe, expect, test } from 'bun:test';
import {
  classifyRefreshFailure,
  isRequiresInstallationError,
  isUnauthorizedError,
  markTransientAuthFailure,
  shouldRetrySessionRestore,
} from './authRequestFailure';

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

function networkError(): AxiosError {
  return new AxiosError('Network Error', 'ERR_NETWORK');
}

describe('classifyRefreshFailure', () => {
  test('treats 401 as an invalid session', () => {
    expect(classifyRefreshFailure(httpError(401))).toBe('unauthenticated');
  });

  test('treats deploy downtime and other non-401 failures as transient', () => {
    expect(classifyRefreshFailure(networkError())).toBe('transient');
    expect(classifyRefreshFailure(httpError(502))).toBe('transient');
    expect(classifyRefreshFailure(httpError(503))).toBe('transient');
    expect(classifyRefreshFailure(httpError(429))).toBe('transient');
    expect(classifyRefreshFailure(httpError(500))).toBe('transient');
  });
});

describe('shouldRetrySessionRestore', () => {
  test('retries network and 5xx failures', () => {
    expect(shouldRetrySessionRestore(networkError())).toBe(true);
    expect(shouldRetrySessionRestore(httpError(502))).toBe(true);
    expect(shouldRetrySessionRestore(httpError(503))).toBe(true);
  });

  test('does not retry a confirmed 401', () => {
    expect(isUnauthorizedError(httpError(401))).toBe(true);
    expect(shouldRetrySessionRestore(httpError(401))).toBe(false);
  });

  test('retries a 401 when refresh failed transiently', () => {
    const error = httpError(401);
    markTransientAuthFailure(error);
    expect(shouldRetrySessionRestore(error)).toBe(true);
  });

  test('stops on installation 503', () => {
    const error = httpError(503, { requiresInstallation: true, error: 'Not installed' });
    expect(isRequiresInstallationError(error)).toBe(true);
    expect(shouldRetrySessionRestore(error)).toBe(false);
  });
});
