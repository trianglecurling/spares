import axios, { type AxiosError, type AxiosRequestConfig } from 'axios';
import { clearCachedMemberDisplayName } from './memberDisplayCache';
import { isPublicLightPath } from './publicLightPaths';

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

let refreshPromise: Promise<string | null> | null = null;

function hasRequiresInstallation(data: unknown): data is { requiresInstallation: boolean } {
  return typeof data === 'object' && data !== null && (data as { requiresInstallation?: unknown }).requiresInstallation === true;
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  if (!refreshPromise) {
    refreshPromise = axios
      .post<{ accessToken: string; refreshToken: string }>('/api/auth/refresh', { refreshToken })
      .then((response) => {
        storeAuthTokens(response.data.accessToken, response.data.refreshToken);
        return response.data.accessToken;
      })
      .catch(() => {
        clearAuthTokens();
        return null;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
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
      const isAuthEndpoint =
        requestUrl.includes('/auth/refresh') ||
        requestUrl.includes('/auth/request-code') ||
        requestUrl.includes('/auth/verify-code') ||
        requestUrl.includes('/auth/select-member');
      if (originalRequest && !originalRequest._retry && !isAuthEndpoint && getRefreshToken()) {
        originalRequest._retry = true;
        const newAccessToken = await refreshAccessToken();
        if (newAccessToken) {
          originalRequest.headers = {
            ...originalRequest.headers,
            Authorization: `Bearer ${newAccessToken}`,
          };
          return api(originalRequest);
        }
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
