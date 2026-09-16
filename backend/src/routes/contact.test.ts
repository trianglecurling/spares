import { describe, expect, test } from 'bun:test';
import { GROUP_EVENT_CONTACT_RECIPIENT_SLUG } from '../domains/content/publicContactRecipients.js';
import {
  buildContactEmailHtml,
  parseContactRequest,
  resolveContactEmailSubject,
  type ContactRequestPayload,
} from './contact.js';

const baseFields = {
  email: 'jane@example.com',
  captchaToken: 'token',
  captchaAnswer: '4',
};

function groupEventBody(overrides: Record<string, unknown> = {}) {
  return {
    recipient: GROUP_EVENT_CONTACT_RECIPIENT_SLUG,
    ...baseFields,
    fullName: 'Jane Doe',
    organizationName: 'Acme Curling Club',
    ...overrides,
  };
}

function genericBody(overrides: Record<string, unknown> = {}) {
  return {
    recipient: 'general',
    ...baseFields,
    subject: 'Ice availability',
    body: 'Could you tell us more about weekday ice time?',
    ...overrides,
  };
}

describe('parseContactRequest', () => {
  test('accepts a generic contact message with required subject and body', () => {
    const parsed = parseContactRequest(genericBody());
    expect(parsed.success).toBe(true);
  });

  test('requires email for generic and group-event submissions', () => {
    const generic = parseContactRequest(genericBody({ email: '' }));
    expect(generic.success).toBe(false);

    const groupEvent = parseContactRequest(groupEventBody({ email: 'not-an-email' }));
    expect(groupEvent.success).toBe(false);
  });

  test('rejects a generic submission without a long enough message', () => {
    const parsed = parseContactRequest(genericBody({ body: 'Too short' }));
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.flatten().fieldErrors.body?.[0]).toBe('Message is required');
  });

  test('accepts a group-event inquiry with required name, organization, and email', () => {
    const parsed = parseContactRequest(groupEventBody());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.fullName).toBe('Jane Doe');
    expect(parsed.data.organizationName).toBe('Acme Curling Club');
  });

  test('rejects a group-event inquiry without a full name or organization', () => {
    const missingName = parseContactRequest(groupEventBody({ fullName: '   ' }));
    expect(missingName.success).toBe(false);
    if (!missingName.success) {
      expect(missingName.error.flatten().fieldErrors.fullName?.[0]).toBe('Full name is required');
    }

    const missingOrg = parseContactRequest(groupEventBody({ organizationName: '' }));
    expect(missingOrg.success).toBe(false);
    if (!missingOrg.success) {
      expect(missingOrg.error.flatten().fieldErrors.organizationName?.[0]).toBe(
        'Company/organization/group name is required',
      );
    }
  });

  test('allows optional group-event fields and additional comments', () => {
    const parsed = parseContactRequest(
      groupEventBody({
        estimatedGroupSize: '12-16',
        preferredDates: 'Next Tuesday afternoon, or April 4',
        body: 'Do you have vegetarian options?',
      }),
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.estimatedGroupSize).toBe('12-16');
    expect(parsed.data.preferredDates).toBe('Next Tuesday afternoon, or April 4');
    expect(parsed.data.body).toBe('Do you have vegetarian options?');
  });
});

describe('contact email content', () => {
  test('uses an organization-based subject for group-event inquiries', () => {
    const parsed = parseContactRequest(groupEventBody());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(resolveContactEmailSubject(parsed.data)).toBe('Group event inquiry from Acme Curling Club');
  });

  test('includes group-event fields in the coordinator email', () => {
    const parsed = parseContactRequest(
      groupEventBody({
        estimatedGroupSize: '16',
        preferredDates: 'Weekday afternoons in March',
        body: 'Is the warm room available?',
      }),
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const html = buildContactEmailHtml({
      payload: parsed.data,
      recipientLabel: 'Private events, team building, corporate outings',
      isCopy: false,
    });

    expect(html).toContain('New group event inquiry');
    expect(html).toContain('Jane Doe');
    expect(html).toContain('Acme Curling Club');
    expect(html).toContain('Estimated group size');
    expect(html).toContain('Preferred dates');
    expect(html).toContain('Weekday afternoons in March');
    expect(html).toContain('Additional questions/comments');
    expect(html).toContain('Is the warm room available?');
    expect(html).not.toContain('<strong>Subject:</strong>');
  });

  test('keeps generic contact emails on the original subject and message layout', () => {
    const parsed = parseContactRequest(genericBody());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const payload: ContactRequestPayload = parsed.data;
    const html = buildContactEmailHtml({
      payload,
      recipientLabel: 'General info and questions',
      isCopy: false,
    });

    expect(html).toContain('New public contact submission');
    expect(html).toContain('Ice availability');
    expect(html).toContain('Could you tell us more about weekday ice time?');
    expect(html).not.toContain('Preferred dates');
  });
});
