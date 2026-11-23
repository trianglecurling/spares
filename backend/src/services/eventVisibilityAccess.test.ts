import { describe, expect, test } from 'bun:test';
import type { Member, MemberMembershipStatus } from '../types.js';
import {
  eventVisibilityFilterForCalendar,
  eventVisibilityFilterForMember,
  memberCanRegisterForEventVisibility,
  memberEventRegistrationDeniedMessage,
} from './eventVisibilityAccess.js';

function memberWith(status: MemberMembershipStatus, lifetimeMember = 0): Member {
  return {
    id: 1,
    lifetime_member: lifetimeMember,
    membershipStatus: status,
  } as Member;
}

const active: MemberMembershipStatus = {
  validThrough: '2027-06-30',
  isSocialMember: false,
  isSpareOnly: false,
  isActive: true,
};

describe('member event visibility', () => {
  test('guests can register only for public events', () => {
    expect(memberCanRegisterForEventVisibility(null, 'public')).toBe(true);
    expect(memberCanRegisterForEventVisibility(null, 'active_members')).toBe(false);
    expect(memberCanRegisterForEventVisibility(null, 'ice_members')).toBe(false);
    expect(eventVisibilityFilterForMember(null)).toEqual(['public']);
  });

  test('a signed-in account without a current membership cannot register for member events', () => {
    const former = memberWith({
      validThrough: '2025-06-30',
      isSocialMember: false,
      isSpareOnly: false,
      isActive: false,
    });
    expect(memberCanRegisterForEventVisibility(former, 'active_members')).toBe(false);
    expect(memberCanRegisterForEventVisibility(former, 'ice_members')).toBe(false);
    expect(eventVisibilityFilterForMember(former)).toEqual(['public']);
  });

  test('any current club membership can register for member events, including social and spare-only', () => {
    const social = memberWith({ ...active, isSocialMember: true });
    const spare = memberWith({ ...active, isSpareOnly: true });
    const regular = memberWith(active);

    for (const member of [social, spare, regular]) {
      expect(memberCanRegisterForEventVisibility(member, 'public')).toBe(true);
      expect(memberCanRegisterForEventVisibility(member, 'active_members')).toBe(true);
    }

    expect(memberCanRegisterForEventVisibility(social, 'ice_members')).toBe(false);
    expect(memberCanRegisterForEventVisibility(spare, 'ice_members')).toBe(true);
    expect(memberCanRegisterForEventVisibility(regular, 'ice_members')).toBe(true);
    expect(eventVisibilityFilterForMember(regular)).toEqual(['public', 'active_members', 'ice_members']);
    expect(eventVisibilityFilterForMember(spare)).toEqual(['public', 'active_members', 'ice_members']);
    expect(eventVisibilityFilterForMember(social)).toEqual(['public', 'active_members']);
  });

  test('the calendar shows member-only events to every viewer', () => {
    const social = memberWith({ ...active, isSocialMember: true });
    const former = memberWith({
      validThrough: '2025-06-30',
      isSocialMember: false,
      isSpareOnly: false,
      isActive: false,
    });
    const regular = memberWith(active);

    expect(eventVisibilityFilterForCalendar(null)).toEqual(['public', 'active_members']);
    expect(eventVisibilityFilterForCalendar(former)).toEqual(['public', 'active_members']);
    expect(eventVisibilityFilterForCalendar(social)).toEqual(['public', 'active_members']);
    expect(eventVisibilityFilterForCalendar(regular)).toEqual(['public', 'active_members', 'ice_members']);
  });

  test('lifetime members can register for member and ice-member events', () => {
    const lifetime = memberWith(
      { validThrough: null, isSocialMember: false, isSpareOnly: false, isActive: true },
      1,
    );
    expect(memberCanRegisterForEventVisibility(lifetime, 'active_members')).toBe(true);
    expect(memberCanRegisterForEventVisibility(lifetime, 'ice_members')).toBe(true);
  });

  test('denial copy names the audience', () => {
    expect(memberEventRegistrationDeniedMessage('active_members')).toBe(
      'This event is available to Triangle Curling members only.',
    );
    expect(memberEventRegistrationDeniedMessage('ice_members')).toBe(
      'This event is available to Triangle Curling ice members only.',
    );
    expect(memberEventRegistrationDeniedMessage('public')).toBeNull();
  });
});
