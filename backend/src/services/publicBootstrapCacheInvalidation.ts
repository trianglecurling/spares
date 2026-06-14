import { invalidatePublicBootstrapCache } from './publicBootstrapCache.js';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function pathMatchesPublicBootstrapMutation(path: string, method: string): boolean {
  if (!MUTATION_METHODS.has(method)) {
    return false;
  }

  if (path.startsWith('/api/content/')) {
    return true;
  }

  if (path.startsWith('/api/sponsorship/')) {
    return true;
  }

  if (path.startsWith('/api/calendar/')) {
    return true;
  }

  if (path === '/api/events' || /^\/api\/events\/\d+/.test(path)) {
    return true;
  }

  if (path === '/api/config' || path.startsWith('/api/config/')) {
    return true;
  }

  if (path === '/api/governance/settings') {
    return true;
  }

  return false;
}

export function maybeInvalidatePublicBootstrapCache(request: {
  method: string;
  url: string;
}, statusCode: number): void {
  if (statusCode < 200 || statusCode >= 300) {
    return;
  }

  const path = request.url.split('?')[0] ?? '';
  if (!pathMatchesPublicBootstrapMutation(path, request.method)) {
    return;
  }

  invalidatePublicBootstrapCache(path);
}
