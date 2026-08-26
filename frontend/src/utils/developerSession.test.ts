import { describe, expect, test } from 'bun:test';
import {
  DEVELOPER_SESSION_STORAGE_KEY,
  clearDeveloperSessionStash,
  parseDeveloperSessionStash,
  readDeveloperSessionStash,
  resolveDeveloperSession,
  writeDeveloperSessionStash,
  type DeveloperSessionStash,
} from './developerSession';

function memoryStorage(initial?: Record<string, string>) {
  const data = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

const stash: DeveloperSessionStash = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  operatorMemberId: 1,
  operatorName: 'Ada Admin',
  targetMemberId: 42,
  targetName: 'Morgan Member',
};

describe('parseDeveloperSessionStash', () => {
  test('accepts a v1 stash', () => {
    expect(parseDeveloperSessionStash(JSON.stringify({ v: 1, ...stash }))).toEqual(stash);
  });

  test('rejects malformed or incomplete payloads', () => {
    expect(parseDeveloperSessionStash(null)).toBeNull();
    expect(parseDeveloperSessionStash('{')).toBeNull();
    expect(parseDeveloperSessionStash(JSON.stringify({ ...stash, v: 2 }))).toBeNull();
    expect(parseDeveloperSessionStash(JSON.stringify({ v: 1, ...stash, accessToken: '' }))).toBeNull();
  });
});

describe('developer session storage', () => {
  test('round-trips a stash and clears invalid stored values', () => {
    const storage = memoryStorage();
    writeDeveloperSessionStash(stash, storage);
    expect(readDeveloperSessionStash(storage)).toEqual(stash);

    storage.setItem(DEVELOPER_SESSION_STORAGE_KEY, 'not-json');
    expect(readDeveloperSessionStash(storage)).toBeNull();
    expect(storage.getItem(DEVELOPER_SESSION_STORAGE_KEY)).toBeNull();

    writeDeveloperSessionStash(stash, storage);
    clearDeveloperSessionStash(storage);
    expect(readDeveloperSessionStash(storage)).toBeNull();
  });

  test('keeps the operator stash while signed in as someone else', () => {
    const storage = memoryStorage();
    writeDeveloperSessionStash(stash, storage);
    expect(resolveDeveloperSession(42, storage)).toEqual({
      operatorMemberId: 1,
      operatorName: 'Ada Admin',
      targetMemberId: 42,
      targetName: 'Morgan Member',
    });
    expect(readDeveloperSessionStash(storage)).toEqual(stash);
  });

  test('clears the stash when the operator is signed in again', () => {
    const storage = memoryStorage();
    writeDeveloperSessionStash(stash, storage);
    expect(resolveDeveloperSession(1, storage)).toBeNull();
    expect(readDeveloperSessionStash(storage)).toBeNull();
  });
});
