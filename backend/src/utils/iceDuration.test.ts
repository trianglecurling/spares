import { describe, expect, test } from 'bun:test';
import {
  ICE_DURATION_DEFAULT_MINUTES,
  formatIceDuration,
  isIceDurationMinutes,
  snapIceDurationMinutes,
} from './iceDuration.js';

describe('isIceDurationMinutes', () => {
  test('accepts 15-minute steps from 15 minutes through 3 hours', () => {
    expect(isIceDurationMinutes(15)).toBe(true);
    expect(isIceDurationMinutes(45)).toBe(true);
    expect(isIceDurationMinutes(60)).toBe(true);
    expect(isIceDurationMinutes(180)).toBe(true);
  });

  test('rejects values outside the range or off the step', () => {
    expect(isIceDurationMinutes(0)).toBe(false);
    expect(isIceDurationMinutes(10)).toBe(false);
    expect(isIceDurationMinutes(20)).toBe(false);
    expect(isIceDurationMinutes(195)).toBe(false);
    expect(isIceDurationMinutes(60.5)).toBe(false);
  });
});

describe('snapIceDurationMinutes', () => {
  test('snaps to the nearest allowed step and clamps', () => {
    expect(snapIceDurationMinutes(70)).toBe(75);
    expect(snapIceDurationMinutes(7)).toBe(15);
    expect(snapIceDurationMinutes(200)).toBe(180);
    expect(snapIceDurationMinutes(Number.NaN)).toBe(ICE_DURATION_DEFAULT_MINUTES);
  });
});

describe('formatIceDuration', () => {
  test('uses hours and minutes in sentence case', () => {
    expect(formatIceDuration(15)).toBe('15 minutes');
    expect(formatIceDuration(60)).toBe('1 hour');
    expect(formatIceDuration(75)).toBe('1 hour 15 minutes');
    expect(formatIceDuration(120)).toBe('2 hours');
    expect(formatIceDuration(180)).toBe('3 hours');
  });
});
