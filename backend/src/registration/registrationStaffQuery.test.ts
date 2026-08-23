import { describe, expect, test } from 'bun:test';
import {
  parseRegistrationStaffQuery,
  queryRelaxesListableScope,
  registrationQueryFieldCatalog,
  RegistrationQueryValidationError,
} from './registrationStaffQuery.js';

describe('parseRegistrationStaffQuery', () => {
  test('returns an empty all-match query for blank input', () => {
    expect(parseRegistrationStaffQuery(undefined)).toEqual({ match: 'all', rules: [] });
    expect(parseRegistrationStaffQuery('')).toEqual({ match: 'all', rules: [] });
  });

  test('parses combined membership, pronoun, and USWCA filters', () => {
    const query = parseRegistrationStaffQuery(
      JSON.stringify({
        match: 'all',
        rules: [
          { field: 'membershipOption', operator: 'eq', value: 'social' },
          { field: 'preferredPronouns', operator: 'eq', value: 'She/Her' },
          { field: 'uswcaMembershipOptIn', operator: 'eq', value: false },
        ],
      }),
    );
    expect(query.match).toBe('all');
    expect(query.rules).toEqual([
      { field: 'membershipOption', operator: 'eq', value: 'social' },
      { field: 'preferredPronouns', operator: 'eq', value: 'She/Her' },
      { field: 'uswcaMembershipOptIn', operator: 'eq', value: false },
    ]);
  });

  test('parses a requested-league filter', () => {
    const query = parseRegistrationStaffQuery({
      match: 'all',
      rules: [{ field: 'requestedLeagueId', operator: 'eq', value: '12' }],
    });
    expect(query.rules[0]).toEqual({ field: 'requestedLeagueId', operator: 'eq', value: '12' });
  });

  test('rejects unknown fields', () => {
    expect(() =>
      parseRegistrationStaffQuery({
        match: 'all',
        rules: [{ field: 'notAField', operator: 'eq', value: 'x' }],
      }),
    ).toThrow(RegistrationQueryValidationError);
  });

  test('rejects operators that the field does not support', () => {
    expect(() =>
      parseRegistrationStaffQuery({
        match: 'all',
        rules: [{ field: 'isDraft', operator: 'contains', value: 'yes' }],
      }),
    ).toThrow(RegistrationQueryValidationError);
  });
});

describe('registrationQueryFieldCatalog', () => {
  test('covers registration questions including pronouns, membership, and leagues', () => {
    const keys = registrationQueryFieldCatalog([{ value: '1', label: 'Sunday Morning' }]).map((field) => field.key);
    expect(keys).toContain('membershipOption');
    expect(keys).toContain('preferredPronouns');
    expect(keys).toContain('uswcaMembershipOptIn');
    expect(keys).toContain('usaCurlingMembershipOptIn');
    expect(keys).toContain('requestedLeagueId');
    expect(keys).toContain('studentDiscountClaimed');
    expect(keys).toContain('financialAssistanceStatus');
    expect(keys).toContain('age');
    expect(keys).toContain('guardianEmail');
    expect(keys).toContain('acceptedPolicyType');
    expect(keys).toContain('selectionType');
    expect(keys).toContain('isDraft');
    expect(keys).toContain('paymentStatus');
    expect(keys).toContain('paymentDeferred');
    expect(keys).toContain('returningMember');
    expect(keys).toContain('hasWaitlist');
    expect(keys).toContain('hasPendingOffer');
    const requestedLeague = registrationQueryFieldCatalog([{ value: '1', label: 'Sunday Morning' }]).find(
      (field) => field.key === 'requestedLeagueId',
    );
    expect(requestedLeague?.options).toEqual([{ value: '1', label: 'Sunday Morning' }]);
  });
});

describe('queryRelaxesListableScope', () => {
  test('keeps the submitted-only default when filtering membership', () => {
    expect(
      queryRelaxesListableScope({
        match: 'all',
        rules: [{ field: 'membershipOption', operator: 'eq', value: 'social' }],
      }),
    ).toBe(false);
  });

  test('includes drafts when status or draft filters are present', () => {
    expect(
      queryRelaxesListableScope({
        match: 'all',
        rules: [{ field: 'isDraft', operator: 'eq', value: true }],
      }),
    ).toBe(true);
    expect(
      queryRelaxesListableScope({
        match: 'all',
        rules: [{ field: 'status', operator: 'eq', value: 'identity_incomplete' }],
      }),
    ).toBe(true);
  });
});
