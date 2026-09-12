import { describe, expect, test } from 'bun:test';
import {
  rosterConfirmationSendErrorsFromJob,
  rosterConfirmationSendJobErrors,
  rosterConfirmationSendProgressFromJob,
  rosterConfirmationSendProgressLabel,
  rosterConfirmationSendProgressPercent,
} from './rosterConfirmationEmailSend';

describe('roster confirmation send progress', () => {
  test('maps a persisted job onto the progress meter', () => {
    const job = {
      status: 'running' as const,
      total: 60,
      completed: 15,
      sent: 14,
      failed: 1,
      errors: [
        { memberId: 9, memberName: 'Alex', error: 'The email could not be sent.' },
        { memberId: 0, memberName: 'Send job', error: 'Turn off league processing.' },
      ],
    };
    expect(rosterConfirmationSendProgressFromJob(job)).toEqual({
      completed: 15,
      total: 60,
      sent: 14,
      failed: 1,
    });
    expect(rosterConfirmationSendProgressPercent(rosterConfirmationSendProgressFromJob(job))).toBe(25);
    expect(rosterConfirmationSendProgressLabel(rosterConfirmationSendProgressFromJob(job))).toBe('Sending 15 of 60');
    expect(rosterConfirmationSendProgressLabel(rosterConfirmationSendProgressFromJob(job), 'completed')).toBe(
      'Sent 14 of 60',
    );
    expect(rosterConfirmationSendErrorsFromJob(job)).toEqual({ 9: 'The email could not be sent.' });
    expect(rosterConfirmationSendJobErrors(job)).toEqual(['Turn off league processing.']);
  });
});
