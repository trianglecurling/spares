import { describe, expect, test } from 'bun:test';
import {
  emptyRegistrationStaffQuery,
  parseRegistrationStaffQueryParam,
  registrationListHref,
  registrationStaffQuery,
  registrationStaffRule,
  serializeRegistrationStaffQuery,
} from './registrationStaffQuery';

describe('serializeRegistrationStaffQuery', () => {
  test('omits empty queries from the URL payload', () => {
    expect(serializeRegistrationStaffQuery(emptyRegistrationStaffQuery())).toBe('');
    expect(serializeRegistrationStaffQuery({ match: 'any', rules: [] })).toBe('');
  });

  test('preserves combined membership, pronoun, and USWCA rules', () => {
    const query = registrationStaffQuery([
      registrationStaffRule('membershipOption', 'eq', 'social'),
      registrationStaffRule('preferredPronouns', 'eq', 'She/Her'),
      registrationStaffRule('uswcaMembershipOptIn', 'eq', false),
    ]);
    expect(JSON.parse(serializeRegistrationStaffQuery(query))).toEqual(query);
  });
});

describe('parseRegistrationStaffQueryParam', () => {
  test('returns an empty query for blank or invalid JSON', () => {
    expect(parseRegistrationStaffQueryParam(null)).toEqual(emptyRegistrationStaffQuery());
    expect(parseRegistrationStaffQueryParam('not-json')).toEqual(emptyRegistrationStaffQuery());
  });
});

describe('registrationListHref', () => {
  test('keeps session and encodes a social-membership drill-down', () => {
    const href = registrationListHref(
      7,
      registrationStaffQuery([registrationStaffRule('membershipOption', 'eq', 'social')]),
    );
    expect(href.startsWith('/admin/registrations/list?')).toBe(true);
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.get('sessionId')).toBe('7');
    expect(JSON.parse(params.get('q') ?? '')).toEqual({
      match: 'all',
      rules: [{ field: 'membershipOption', operator: 'eq', value: 'social' }],
    });
  });
});
