import { describe, expect, test } from 'bun:test';
import {
  rosterConfirmationSendBatches,
  rosterConfirmationSendProgressLabel,
  rosterConfirmationSendProgressPercent,
} from './rosterConfirmationEmailSend';

describe('roster confirmation send progress', () => {
  test('splits member ids into batches', () => {
    expect(rosterConfirmationSendBatches([1, 2, 3, 4, 5, 6], 5)).toEqual([
      [1, 2, 3, 4, 5],
      [6],
    ]);
    expect(rosterConfirmationSendBatches([], 5)).toEqual([]);
  });

  test('reports percent and label from completed counts', () => {
    const progress = { completed: 15, total: 60, sent: 14, failed: 1 };
    expect(rosterConfirmationSendProgressPercent(progress)).toBe(25);
    expect(rosterConfirmationSendProgressLabel(progress)).toBe('Sending 15 of 60');
  });
});
