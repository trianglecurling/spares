import { describe, expect, test } from 'bun:test';
import {
  spareRequestDeepLinkAlert,
  spareRequestDeepLinkLoadErrorAlert,
} from './spareRequestDeepLinkMessage';

describe('spareRequestDeepLinkAlert', () => {
  test('says a filled request has already been filled', () => {
    expect(spareRequestDeepLinkAlert('filled')).toContain('already been filled');
  });

  test('says a canceled request was canceled', () => {
    expect(spareRequestDeepLinkAlert('cancelled')).toContain('has been canceled');
    expect(spareRequestDeepLinkAlert('cancelled')).not.toContain('deleted');
  });

  test('says an open request is not available to accept yet', () => {
    const message = spareRequestDeepLinkAlert('open');
    expect(message).toContain('still open');
    expect(message).toContain('not currently available for you to accept');
    expect(message).not.toContain('deleted');
  });

  test('explains the bye exclusive window with the opening time when known', () => {
    const message = spareRequestDeepLinkAlert('open', {
      inByeWindow: true,
      opensAt: '2026-01-10T18:00:00.000Z',
      formatOpensAt: () => 'Sat 1:00 PM',
    });
    expect(message).toContain('Players on bye get first chance');
    expect(message).toContain('Sat 1:00 PM');
  });

  test('explains the bye exclusive window without a time when the window is still pending', () => {
    const message = spareRequestDeepLinkAlert('open', { inByeWindow: true, opensAt: null });
    expect(message).toContain('when their exclusive window ends');
  });
});

describe('spareRequestDeepLinkLoadErrorAlert', () => {
  test('does not describe a missing or forbidden request as deleted', () => {
    expect(spareRequestDeepLinkLoadErrorAlert(404)).toContain('could not be found');
    expect(spareRequestDeepLinkLoadErrorAlert(403)).toContain('not available to you');
    expect(spareRequestDeepLinkLoadErrorAlert(404)).not.toContain('deleted');
    expect(spareRequestDeepLinkLoadErrorAlert(403)).not.toContain('deleted');
  });
});
