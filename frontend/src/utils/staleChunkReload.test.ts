import { describe, expect, test } from 'bun:test';
import {
  STALE_CHUNK_RELOAD_COOLDOWN_MS,
  STALE_CHUNK_RELOAD_STORAGE_KEY,
  isStaleChunkError,
  recoverFromStaleChunk,
} from './staleChunkReload';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = { ...initial };
  return {
    get length() {
      return Object.keys(data).length;
    },
    clear() {
      for (const key of Object.keys(data)) delete data[key];
    },
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key]! : null;
    },
    key() {
      return null;
    },
    removeItem(key: string) {
      delete data[key];
    },
    setItem(key: string, value: string) {
      data[key] = String(value);
    },
  };
}

describe('isStaleChunkError', () => {
  test('matches Vite dynamic import fetch failures', () => {
    expect(
      isStaleChunkError(
        new TypeError(
          'Failed to fetch dynamically imported module: https://tccnc.club/assets/Dashboard-C8Bcy6ga.js',
        ),
      ),
    ).toBe(true);
  });

  test('ignores unrelated errors', () => {
    expect(isStaleChunkError(new Error('Network Error'))).toBe(false);
  });
});

describe('recoverFromStaleChunk', () => {
  test('reloads once and records the attempt', () => {
    const storage = memoryStorage();
    let reloads = 0;
    const now = 1_000_000;

    const recovered = recoverFromStaleChunk({
      storage,
      now,
      reload: () => {
        reloads += 1;
      },
    });

    expect(recovered).toBe(true);
    expect(reloads).toBe(1);
    expect(storage.getItem(STALE_CHUNK_RELOAD_STORAGE_KEY)).toBe(String(now));
  });

  test('does not reload again inside the cooldown window', () => {
    const now = 1_000_000;
    const storage = memoryStorage({
      [STALE_CHUNK_RELOAD_STORAGE_KEY]: String(now - 1_000),
    });
    let reloads = 0;

    const recovered = recoverFromStaleChunk({
      storage,
      now,
      reload: () => {
        reloads += 1;
      },
    });

    expect(recovered).toBe(false);
    expect(reloads).toBe(0);
  });

  test('allows another reload after the cooldown', () => {
    const now = 1_000_000;
    const storage = memoryStorage({
      [STALE_CHUNK_RELOAD_STORAGE_KEY]: String(now - STALE_CHUNK_RELOAD_COOLDOWN_MS - 1),
    });
    let reloads = 0;

    const recovered = recoverFromStaleChunk({
      storage,
      now,
      reload: () => {
        reloads += 1;
      },
    });

    expect(recovered).toBe(true);
    expect(reloads).toBe(1);
  });
});
