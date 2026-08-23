import { describe, expect, test } from 'bun:test';
import {
  experienceLabel,
  financialAssistanceLabel,
  guardianName,
  icePrivilegesChoiceLabel,
  membershipOptInLabel,
  nameTagPronounsLabel,
  nameTagReplacementLabel,
  reciprocalDiscountLabel,
  studentDiscountLabel,
} from './registrationCollectedDetailsShared';

describe('registration collected detail labels', () => {
  test('ice privileges uses the registration-step wording', () => {
    expect(icePrivilegesChoiceLabel('league_play')).toBe('League play or instructional programs');
    expect(icePrivilegesChoiceLabel('basic_ice')).toBe('Basic ice privileges');
    expect(icePrivilegesChoiceLabel('none')).toBe('None');
    expect(icePrivilegesChoiceLabel(null)).toBe('Not collected');
  });

  test('experience includes reported years when provided', () => {
    expect(experienceLabel('none_or_minimal', null)).toBe('None or minimal');
    expect(experienceLabel('specified_years', 1)).toBe('1 year');
    expect(experienceLabel('specified_years', 2.5)).toBe('2.5 years');
    expect(experienceLabel('known_existing', null)).toBe('Club experience on file');
    expect(experienceLabel(null, null)).toBe('Not collected');
  });

  test('membership opt-in distinguishes opted out from missing', () => {
    expect(membershipOptInLabel(true)).toBe('Opted in');
    expect(membershipOptInLabel(false)).toBe('Opted out');
    expect(membershipOptInLabel(null)).toBe('Not collected');
  });

  test('name tag replacement distinguishes declined from not asked', () => {
    expect(nameTagReplacementLabel(0)).toBe('None purchased');
    expect(nameTagReplacementLabel(1)).toBe('1 purchased');
    expect(nameTagReplacementLabel(3)).toBe('3 purchased');
    expect(nameTagReplacementLabel(null)).toBe('Not asked');
  });

  test('name tag pronouns can be included, omitted, or missing', () => {
    expect(nameTagPronounsLabel(true)).toBe('Included');
    expect(nameTagPronounsLabel(false)).toBe('Not included');
    expect(nameTagPronounsLabel(null)).toBe('Not collected');
  });

  test('discount labels include the justification when claimed', () => {
    expect(studentDiscountLabel({ studentDiscountClaimed: true, studentInstitution: 'Duke' })).toBe('Duke');
    expect(studentDiscountLabel({ studentDiscountClaimed: true, studentInstitution: '  ' })).toBe('Claimed');
    expect(studentDiscountLabel({ studentDiscountClaimed: false, studentInstitution: 'Duke' })).toBeNull();
    expect(reciprocalDiscountLabel({ reciprocalDiscountClaimed: true, reciprocalClubName: 'Charlotte' })).toBe(
      'Charlotte',
    );
    expect(reciprocalDiscountLabel({ reciprocalDiscountClaimed: false, reciprocalClubName: null })).toBeNull();
  });

  test('financial assistance includes request status', () => {
    expect(
      financialAssistanceLabel({ requestedPercent: 50, approvedPercent: null, status: 'pending' }),
    ).toBe('50% requested, pending review');
    expect(
      financialAssistanceLabel({ requestedPercent: 75, approvedPercent: 50, status: 'partially_approved' }),
    ).toBe('75% requested, 50% approved');
    expect(
      financialAssistanceLabel({ requestedPercent: 25, approvedPercent: null, status: 'denied' }),
    ).toBe('25% requested, denied');
    expect(financialAssistanceLabel(null)).toBeNull();
  });

  test('guardian name joins available parts', () => {
    expect(guardianName({ firstName: 'Pat', lastName: 'Lee', email: null, phone: null })).toBe('Pat Lee');
    expect(guardianName({ firstName: null, lastName: null, email: 'a@b.com', phone: null })).toBe('Not available');
  });
});
