/**
 * Recover from Vite lazy-chunk 404s after a deploy (version skew).
 *
 * A tab that stayed open across a release still points at old hashed assets like
 * `/assets/Dashboard-C8Bcy6ga.js`. Client-side navigation then fails with
 * "Failed to fetch dynamically imported module" and a blank page.
 *
 * Vite emits `vite:preloadError` for this; a single reload picks up the new
 * index.html and current chunk hashes.
 */

import { createElement, lazy, type ComponentType, type LazyExoticComponent } from 'react';

export const STALE_CHUNK_RELOAD_STORAGE_KEY = 'tbs:stale-chunk-reload-at';

/** Suppress repeat reloads so a persistent asset failure cannot loop forever. */
export const STALE_CHUNK_RELOAD_COOLDOWN_MS = 30_000;

const CHUNK_ERROR_SNIPPETS = [
  'Failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'Importing a module script failed',
] as const;

type RecoverOptions = {
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  now?: number;
  reload?: () => void;
};

export function isStaleChunkError(error: unknown): boolean {
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : error && typeof error === 'object' && 'message' in error
          ? String((error as { message: unknown }).message)
          : '';
  return CHUNK_ERROR_SNIPPETS.some((snippet) => message.includes(snippet));
}

/**
 * Returns true when a reload was started. Returns false when a reload already
 * happened recently (caller should show a manual refresh affordance).
 */
export function recoverFromStaleChunk(options: RecoverOptions = {}): boolean {
  const storage = options.storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
  const now = options.now ?? Date.now();
  const reload =
    options.reload ??
    (() => {
      window.location.reload();
    });

  if (!storage) {
    reload();
    return true;
  }

  const previousRaw = storage.getItem(STALE_CHUNK_RELOAD_STORAGE_KEY);
  const previousAt = previousRaw != null ? Number(previousRaw) : NaN;
  if (Number.isFinite(previousAt) && now - previousAt < STALE_CHUNK_RELOAD_COOLDOWN_MS) {
    return false;
  }

  storage.setItem(STALE_CHUNK_RELOAD_STORAGE_KEY, String(now));
  reload();
  return true;
}

/** Never resolves — keeps Suspense pending while a recovery reload runs. */
function pendingUntilReload<T>(): Promise<T> {
  return new Promise(() => {});
}

function StaleChunkReloadPrompt() {
  return createElement(
    'div',
    { className: 'mx-auto max-w-lg px-4 py-12 text-center' },
    createElement('p', { className: 'text-base font-medium text-gray-800 dark:text-gray-100' }, 'Update available'),
    createElement(
      'p',
      { className: 'mt-2 text-sm text-gray-600 dark:text-gray-300' },
      'A newer version of the site was deployed. Refresh to continue.',
    ),
    createElement(
      'button',
      {
        type: 'button',
        className:
          'mt-4 inline-flex min-h-[2.5rem] items-center justify-center rounded-lg bg-primary-teal px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/50',
        onClick: () => {
          window.location.reload();
        },
      },
      'Refresh page',
    ),
  );
}

function recoverOrPrompt(): Promise<{ default: ComponentType<any> }> {
  if (recoverFromStaleChunk()) {
    return pendingUntilReload();
  }
  return Promise.resolve({ default: StaleChunkReloadPrompt });
}

/**
 * React.lazy wrapper for route chunks. On stale-asset failure (or a swallowed
 * Vite preload error that resolves without a module), reload instead of blanking.
 */
export function lazyRoute<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const mod = await factory();
      if (mod?.default) {
        return mod;
      }
      return recoverOrPrompt() as Promise<{ default: T }>;
    } catch (error) {
      if (isStaleChunkError(error)) {
        return recoverOrPrompt() as Promise<{ default: T }>;
      }
      throw error;
    }
  });
}

export function installStaleChunkReloadHandler(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('vite:preloadError', (event) => {
    // Mark handled so Vite does not rethrow into an uncaught rejection / blank tree.
    event.preventDefault();
    recoverFromStaleChunk();
  });
}
