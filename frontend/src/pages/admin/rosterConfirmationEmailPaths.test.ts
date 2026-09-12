import { describe, expect, test } from 'bun:test';
import { rosterConfirmationEmailListPath, rosterConfirmationEmailPreviewPath } from './rosterConfirmationEmailPaths';

describe('roster confirmation email paths', () => {
  test('opens a preview with a real member route and session query', () => {
    expect(rosterConfirmationEmailPreviewPath(165, 3)).toBe('/admin/registrations/roster-emails/165?sessionId=3');
  });

  test('returns to the list with the same session', () => {
    expect(rosterConfirmationEmailListPath(3)).toBe('/admin/registrations/roster-emails?sessionId=3');
  });
});
