import { describe, expect, test } from 'bun:test';
import { calendarEventDescriptionForSave } from './calendarEventFormShared';

describe('calendarEventDescriptionForSave', () => {
  test('uses the editor markdown when the instance is ready', () => {
    expect(calendarEventDescriptionForSave('Updated notes', 'Old notes')).toBe('Updated notes');
  });

  test('keeps the draft when the editor is unmounted', () => {
    expect(calendarEventDescriptionForSave(undefined, 'Saved on the description tab')).toBe(
      'Saved on the description tab'
    );
  });

  test('omits description when the ready editor is empty', () => {
    expect(calendarEventDescriptionForSave('', 'Saved on the description tab')).toBeUndefined();
  });

  test('omits blank descriptions so updates do not send an empty string', () => {
    expect(calendarEventDescriptionForSave(undefined, '   ')).toBeUndefined();
  });
});
