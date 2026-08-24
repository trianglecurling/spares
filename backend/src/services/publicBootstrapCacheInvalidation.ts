import { invalidatePublicBootstrapCache } from './publicBootstrapCache.js';
import { invalidateMenuTreeCache } from './menuTreeCache.js';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function normalizeMutationPath(url: string): string {
  const path = (url.split('?')[0] ?? '').replace(/\/+$/, '') || '/';
  if (path.startsWith('/api/')) return path;
  return path === '/' ? '/api' : `/api${path}`;
}

export function pathMatchesPublicBootstrapMutation(path: string, method: string): boolean {
  if (!MUTATION_METHODS.has(method.toUpperCase())) {
    return false;
  }

  const normalized = normalizeMutationPath(path);

  if (normalized.startsWith('/api/content/')) {
    return true;
  }

  if (normalized.startsWith('/api/sponsorship/')) {
    return true;
  }

  if (normalized.startsWith('/api/calendar/')) {
    return true;
  }

  if (normalized === '/api/events' || /^\/api\/events\/\d+/.test(normalized)) {
    return true;
  }

  if (normalized === '/api/config' || normalized.startsWith('/api/config/')) {
    return true;
  }

  if (normalized === '/api/governance/settings') {
    return true;
  }

  return false;
}

export function maybeInvalidatePublicBootstrapCache(request: {
  method: string;
  url: string;
  originalUrl?: string;
  raw?: { url?: string };
}, statusCode: number): void {
  if (statusCode < 200 || statusCode >= 300) {
    return;
  }

  const path = normalizeMutationPath(request.originalUrl ?? request.raw?.url ?? request.url);
  if (!pathMatchesPublicBootstrapMutation(path, request.method)) {
    return;
  }

  invalidatePublicBootstrapCache(path);
  if (path.startsWith('/api/content/')) {
    invalidateMenuTreeCache(path);
  }
}
