import { describe, expect, test } from 'bun:test';
import { classifyNewRegistrationEmail } from './registrationEmailRecognition.js';

describe('classifyNewRegistrationEmail', () => {
  test('allows an unrecognized email', () => {
    expect(
      classifyNewRegistrationEmail({
        recognizedMemberId: null,
        candidateEmail: 'new.curler@example.com',
      }),
    ).toBe('allow');
  });

  test('requires login when a guest uses a recognized email', () => {
    expect(
      classifyNewRegistrationEmail({
        recognizedMemberId: 42,
        actorMemberId: null,
        candidateEmail: 'martha@example.com',
      }),
    ).toBe('require_login');
  });

  test('allows a signed-in member to create another profile that shares their email', () => {
    expect(
      classifyNewRegistrationEmail({
        recognizedMemberId: 42,
        actorMemberId: 42,
        actorEmail: 'family@example.com',
        candidateEmail: 'Family@example.com',
      }),
    ).toBe('allow');
  });

  test('blocks a signed-in member from creating a new account with someone else\'s email', () => {
    expect(
      classifyNewRegistrationEmail({
        recognizedMemberId: 99,
        actorMemberId: 42,
        actorEmail: 'parent@example.com',
        candidateEmail: 'existing.curler@example.com',
      }),
    ).toBe('email_in_use');
  });
});
