import { describe, expect, test } from 'bun:test';
import { formatStartsIn } from './SpareNotificationProgress';

const now = new Date('2026-09-28T20:00:00Z');
const inMinutes = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();

describe('formatStartsIn', () => {
  test('shows hours and minutes', () => {
    expect(formatStartsIn(inMinutes(65), now)).toBe('Starting in 1 hr 5 min');
  });

  test('drops a zero part', () => {
    expect(formatStartsIn(inMinutes(42), now)).toBe('Starting in 42 min');
    expect(formatStartsIn(inMinutes(120), now)).toBe('Starting in 2 hr');
  });

  test('rounds the last partial minute to less than a minute', () => {
    expect(formatStartsIn(new Date(now.getTime() + 20_000).toISOString(), now)).toBe(
      'Starting in less than a minute',
    );
    expect(formatStartsIn(inMinutes(-3), now)).toBe('Starting in less than a minute');
  });
});
