import { describe, expect, test } from 'bun:test';
import { contactSettingsNudgeIsVisible } from './contactSettingsNudgeService.js';

describe('contactSettingsNudgeIsVisible', () => {
  test('shows when both directory flags are off and the nudge is not dismissed', () => {
    expect(
      contactSettingsNudgeIsVisible({
        emailVisible: false,
        phoneVisible: false,
        dismissed: false,
      }),
    ).toBe(true);
  });

  test('hides when either directory flag is on', () => {
    expect(
      contactSettingsNudgeIsVisible({
        emailVisible: true,
        phoneVisible: false,
        dismissed: false,
      }),
    ).toBe(false);
    expect(
      contactSettingsNudgeIsVisible({
        emailVisible: false,
        phoneVisible: true,
        dismissed: false,
      }),
    ).toBe(false);
  });

  test('hides after dismiss or confirm', () => {
    expect(
      contactSettingsNudgeIsVisible({
        emailVisible: false,
        phoneVisible: false,
        dismissed: true,
      }),
    ).toBe(false);
  });
});
