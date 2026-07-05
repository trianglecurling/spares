import { describe, expect, test } from 'bun:test';
import {
  computeOpenSpotsFromDemand,
  hasDirectRegistrationCapacity,
} from './eventCapacityLogic.js';

describe('event capacity with waitlist earmarking', () => {
  test('open spots account for waitlist demand not yet holding capacity', () => {
    // Capacity 10, 9 confirmed, 1 waitlisted → no open registration spots.
    expect(computeOpenSpotsFromDemand(10, 9 + 1)).toBe(0);
    expect(hasDirectRegistrationCapacity(10, 10, 1)).toBe(false);
  });

  test('cancellation with waitlist still leaves registration closed', () => {
    // Was full at 10; one cancel → 9 confirmed + 1 waitlisted = 10 demand.
    expect(computeOpenSpotsFromDemand(10, 10)).toBe(0);
    expect(hasDirectRegistrationCapacity(10, 10, 1)).toBe(false);
  });

  test('cancellation with empty waitlist opens a spot', () => {
    expect(computeOpenSpotsFromDemand(10, 9)).toBe(1);
    expect(hasDirectRegistrationCapacity(10, 9, 1)).toBe(true);
  });

  test('pending offer holds capacity without double-counting waitlist demand', () => {
    // 9 confirmed + 1 pending offer hold; waitlist earmark is 0 for that person.
    expect(computeOpenSpotsFromDemand(10, 10)).toBe(0);
  });

  test('unlimited capacity events stay open', () => {
    expect(computeOpenSpotsFromDemand(null, 100)).toBeNull();
    expect(hasDirectRegistrationCapacity(null, 100, 5)).toBe(true);
  });
});
