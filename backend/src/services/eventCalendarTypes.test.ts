import { describe, expect, test } from 'bun:test';
import { eventMatchesCalendarType } from './eventCalendarTypes.js';

describe('eventMatchesCalendarType', () => {
  test('matches a type stored in a JSON array', () => {
    expect(eventMatchesCalendarType('["juniors","bonspiel"]', 'bonspiel')).toBe(true);
    expect(eventMatchesCalendarType('["juniors","bonspiel"]', 'juniors')).toBe(true);
    expect(eventMatchesCalendarType('["juniors","bonspiel"]', 'no-experience-necessary')).toBe(false);
  });

  test('matches a legacy single calendar type id', () => {
    expect(eventMatchesCalendarType('bonspiel-doubles', 'bonspiel')).toBe(true);
    expect(eventMatchesCalendarType('learn-to-curl', 'no-experience-necessary')).toBe(true);
    expect(eventMatchesCalendarType('clinic', 'juniors')).toBe(false);
  });

  test('does not match empty or unknown stored types', () => {
    expect(eventMatchesCalendarType('[]', 'bonspiel')).toBe(false);
    expect(eventMatchesCalendarType(null, 'bonspiel')).toBe(false);
    expect(eventMatchesCalendarType('', 'juniors')).toBe(false);
  });
});
