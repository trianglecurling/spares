import { describe, expect, test } from 'bun:test';
import { localDateTimeToIso } from '../utils/timeZone.js';
import { eventRegistrationSubjectDates } from './webhookService.js';

const EASTERN = 'America/New_York';

describe('eventRegistrationSubjectDates', () => {
  test('uses the club-local calendar date when the instant is the next UTC day', () => {
    // 7:00–9:00 PM Friday ET is 23:00Z Friday → 01:00Z Saturday.
    const startDt = localDateTimeToIso('2026-09-11', '19:00', EASTERN);
    const endDt = localDateTimeToIso('2026-09-11', '21:00', EASTERN);
    expect(startDt).toBe('2026-09-11T23:00:00.000Z');
    expect(endDt).toBe('2026-09-12T01:00:00.000Z');

    expect(eventRegistrationSubjectDates([{ startDt, endDt }], EASTERN)).toEqual({
      eventStartDate: '2026-09-11',
      eventEndDate: '2026-09-11',
    });
  });

  test('spans the earliest local start and latest local end across timespans', () => {
    const dates = eventRegistrationSubjectDates(
      [
        {
          startDt: localDateTimeToIso('2026-09-13', '10:00', EASTERN),
          endDt: localDateTimeToIso('2026-09-13', '12:00', EASTERN),
        },
        {
          startDt: localDateTimeToIso('2026-09-11', '19:00', EASTERN),
          endDt: localDateTimeToIso('2026-09-12', '01:00', EASTERN),
        },
      ],
      EASTERN,
    );

    expect(dates).toEqual({
      eventStartDate: '2026-09-11',
      eventEndDate: '2026-09-13',
    });
  });

  test('omits dates when timespans are missing or unparseable', () => {
    expect(eventRegistrationSubjectDates([], EASTERN)).toEqual({});
    expect(eventRegistrationSubjectDates([{ startDt: 'not-a-date', endDt: 'also-bad' }], EASTERN)).toEqual({});
  });
});
