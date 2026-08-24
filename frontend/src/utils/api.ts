import axios, { type AxiosError, type AxiosRequestConfig } from 'axios';
import { isAccessTokenUsable } from './accessToken';
import { classifyRefreshFailure, markTransientAuthFailure } from './authRequestFailure';
import { clearCachedMemberDisplayName } from './memberDisplayCache';
import { isPublicApiRequestUrl } from './publicApiPaths';
import { isPublicLightPath } from './publicLightPaths';
import { getRegistrationEarlyAccessUnlockToken } from './registrationEarlyAccess';
import type { AccessTokenEnsureResult } from './restoreAuthSession';

type RetriableRequestConfig = AxiosRequestConfig & { _retry?: boolean };

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

export function getAccessToken(): string | null {
  return localStorage.getItem('accessToken') || localStorage.getItem('authToken');
}

export function getRefreshToken(): string | null {
  return localStorage.getItem('refreshToken');
}

export function storeAuthTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem('accessToken', accessToken);
  localStorage.setItem('refreshToken', refreshToken);
  localStorage.removeItem('authToken');
}

export function clearAuthTokens(): void {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('authToken');
  clearCachedMemberDisplayName();
}

let refreshPromise: Promise<AccessTokenEnsureResult> | null = null;

function hasRequiresInstallation(data: unknown): data is { requiresInstallation: boolean } {
  return typeof data === 'object' && data !== null && (data as { requiresInstallation?: unknown }).requiresInstallation === true;
}

async function refreshAccessToken(): Promise<AccessTokenEnsureResult> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return { status: 'unauthenticated' };

  if (!refreshPromise) {
    refreshPromise = axios
      .post<{ accessToken: string; refreshToken: string }>('/api/auth/refresh', { refreshToken })
      .then((response): AccessTokenEnsureResult => {
        storeAuthTokens(response.data.accessToken, response.data.refreshToken);
        return { status: 'ok', accessToken: response.data.accessToken };
      })
      .catch((error: unknown): AccessTokenEnsureResult => {
        // Only wipe the session when the server says the refresh token is invalid.
        // 502/503/network errors during a deploy must not log the member out.
        if (classifyRefreshFailure(error) === 'unauthenticated') {
          clearAuthTokens();
          return { status: 'unauthenticated' };
        }
        return { status: 'transient' };
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

export async function ensureAccessTokenResult(): Promise<AccessTokenEnsureResult> {
  const token = getAccessToken();
  if (token && isAccessTokenUsable(token)) {
    return { status: 'ok', accessToken: token };
  }
  if (!getRefreshToken()) {
    return { status: 'unauthenticated' };
  }
  return refreshAccessToken();
}

/** Return a non-expired access token, refreshing first when needed. */
export async function ensureAccessToken(): Promise<string | null> {
  const result = await ensureAccessTokenResult();
  return result.status === 'ok' ? result.accessToken : null;
}

// Add auth token to requests (skip expired tokens so public guest flows are not blocked)
api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (isAccessTokenUsable(token)) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const earlyAccessToken = getRegistrationEarlyAccessUnlockToken();
  if (earlyAccessToken) {
    const headers = config.headers;
    if (headers && typeof (headers as { set?: unknown }).set === 'function') {
      (headers as { set: (key: string, value: string) => void }).set(
        'X-Registration-Early-Access',
        earlyAccessToken,
      );
    } else if (headers) {
      (headers as Record<string, string>)['X-Registration-Early-Access'] = earlyAccessToken;
    }
  }
  return config;
});

// Handle auth errors
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (error.response?.status === 503 && hasRequiresInstallation(error.response.data)) {
      const currentPath = window.location.pathname;
      // Don't redirect when on / - Install page redirects configured users to /,
      // so redirecting / -> /install -> / would create an infinite loop
      if (!currentPath.startsWith('/install') && currentPath !== '/') {
        window.location.href = '/install';
      }
      return Promise.reject(error);
    }

    if (error.response?.status === 401) {
      const originalRequest = error.config as RetriableRequestConfig | undefined;
      const requestUrl = originalRequest?.url || '';
      const isPublicApi = isPublicApiRequestUrl(requestUrl);
      const isAuthEndpoint =
        requestUrl.includes('/auth/refresh') ||
        requestUrl.includes('/auth/request-code') ||
        requestUrl.includes('/auth/verify-code') ||
        requestUrl.includes('/auth/select-member');
      if (
        originalRequest &&
        !originalRequest._retry &&
        !isAuthEndpoint &&
        !isPublicApi &&
        getRefreshToken()
      ) {
        originalRequest._retry = true;
        const refreshResult = await refreshAccessToken();
        if (refreshResult.status === 'ok') {
          originalRequest.headers = {
            ...originalRequest.headers,
            Authorization: `Bearer ${refreshResult.accessToken}`,
          };
          return api(originalRequest);
        }
        if (refreshResult.status === 'transient') {
          markTransientAuthFailure(error);
          return Promise.reject(error);
        }
      }

      if (isPublicApi) {
        clearAuthTokens();
        return Promise.reject(error);
      }

      const currentPath = window.location.pathname;
      // Don't redirect when on public pages - stale tokens must not block guest flows.
      // Keep in sync with AuthContext + PublicLightThemeOutlet via publicLightPaths.ts.
      if (!currentPath.startsWith('/install') && currentPath !== '/login' && !isPublicLightPath(currentPath)) {
        clearAuthTokens();
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export const formatApiError = (error: unknown, fallback: string) => {
  if (axios.isAxiosError(error)) {
    const serverError = error.response?.data?.error;
    if (typeof serverError === 'string' && serverError.trim().length > 0) {
      return `${fallback}: ${serverError}`;
    }
    const status = error.response?.status;
    if (status) {
      return `${fallback} (status ${status}). Please try again.`;
    }
  }

  if (error instanceof Error && error.message) {
    return `${fallback}: ${error.message}`;
  }

  return fallback;
};

/** Prefer the API `error` string when present; otherwise return `fallback` (no prefix). */
export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const serverError = error.response?.data?.error;
    if (typeof serverError === 'string' && serverError.trim().length > 0) {
      return serverError.trim();
    }
  }
  if (error instanceof Error && error.message?.trim()) {
    return error.message.trim();
  }
  return fallback;
}

export default api;
