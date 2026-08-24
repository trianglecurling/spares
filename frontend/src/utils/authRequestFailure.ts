import axios from 'axios';

const transientAuthFailures = new WeakSet<object>();

export function markTransientAuthFailure(error: unknown): void {
  if (error && typeof error === 'object') {
    transientAuthFailures.add(error);
  }
}

export function isMarkedTransientAuthFailure(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && transientAuthFailures.has(error));
}

export function isUnauthorizedError(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 401;
}

export function isRequiresInstallationError(error: unknown): boolean {
  if (!axios.isAxiosError(error) || error.response?.status !== 503) {
    return false;
  }
  const data = error.response.data;
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { requiresInstallation?: unknown }).requiresInstallation === true
  );
}

/** Refresh-token failures: only a 401 means the stored session is actually gone. */
export function classifyRefreshFailure(error: unknown): 'unauthenticated' | 'transient' {
  if (isUnauthorizedError(error)) {
    return 'unauthenticated';
  }
  return 'transient';
}

/**
 * Session restore should keep retrying unless the server has confirmed the
 * session is invalid (401) or the app still needs installation.
 */
export function shouldRetrySessionRestore(error: unknown): boolean {
  if (isRequiresInstallationError(error)) {
    return false;
  }
  if (isMarkedTransientAuthFailure(error)) {
    return true;
  }
  if (isUnauthorizedError(error)) {
    return false;
  }
  return true;
}
