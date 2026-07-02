import { describe, expect, test } from 'bun:test';
import {
  buildRegistrationFormSnapshot,
  buildRegistrationFormSnapshotFromInput,
  diffRegistrationFormSnapshots,
  shouldNotifyPointOfContactAtRegistration,
} from './eventRegistrationPointOfContactNotification.js';

const event = {
  id: 1,
  title: 'Test Spiel',
  point_of_contact: 'spiels@trianglecurling.com',
  registrationFields: [
    { id: 10, label: 'Team name', field_type: 'preset_team_name', scope: 'group', sort_order: 0 },
    { id: 11, label: 'Shirt size', field_type: 'dropdown', scope: 'individual', sort_order: 1 },
    { id: 12, label: 'Details', field_type: 'subheading', scope: 'group', sort_order: 2 },
  ],
};

describe('event registration point of contact notification', () => {
  test('defers point of contact notification until payment for paid registrations', () => {
    expect(shouldNotifyPointOfContactAtRegistration({ needsPayment: true, status: 'pending_payment' })).toBe(false);
    expect(shouldNotifyPointOfContactAtRegistration({ needsPayment: true, status: 'waitlisted' })).toBe(false);
    expect(shouldNotifyPointOfContactAtRegistration({ needsPayment: false, status: 'confirmed' })).toBe(true);
    expect(shouldNotifyPointOfContactAtRegistration({ needsPayment: false, status: 'waitlisted' })).toBe(true);
  });

  test('builds a full registration snapshot with group members and custom fields', () => {
    const snapshot = buildRegistrationFormSnapshot(
      event,
      { firstName: 'Alex', lastName: 'Curler', email: 'alex@example.com' },
      [{ name: 'Blair Curler', email: 'blair@example.com' }],
      [
        { fieldId: 10, registrationMemberIndex: null, value: 'Ice Breakers' },
        { fieldId: 11, registrationMemberIndex: 0, value: 'Large' },
        { fieldId: 11, registrationMemberIndex: 1, value: 'Medium' },
      ],
    );

    expect(snapshot.rows).toEqual([
      { key: 'contact:firstName', label: 'First name', value: 'Alex' },
      { key: 'contact:lastName', label: 'Last name', value: 'Curler' },
      { key: 'contact:email', label: 'Email address', value: 'alex@example.com' },
      { key: 'groupMember:0:name', label: 'Group member 1 name', value: 'Blair Curler' },
      { key: 'groupMember:0:email', label: 'Group member 1 email', value: 'blair@example.com' },
      { key: 'field:10:group', label: 'Team name', value: 'Ice Breakers' },
      { key: 'field:11:0', label: 'Shirt size (Primary registrant)', value: 'Large' },
      { key: 'field:11:1', label: 'Shirt size (Group member 1)', value: 'Medium' },
    ]);
  });

  test('diffs registration snapshots and reports only changed values', () => {
    const before = buildRegistrationFormSnapshotFromInput(event, {
      contactFirstName: 'Alex',
      contactLastName: 'Curler',
      contactEmail: 'alex@example.com',
      groupMembers: [{ name: 'Blair Curler', email: 'blair@example.com' }],
      fieldValues: [
        { fieldId: 10, registrationMemberIndex: null, value: 'Ice Breakers' },
        { fieldId: 11, registrationMemberIndex: 0, value: 'Large' },
        { fieldId: 11, registrationMemberIndex: 1, value: 'Medium' },
      ],
    });
    const after = buildRegistrationFormSnapshotFromInput(event, {
      contactFirstName: 'Alex',
      contactLastName: 'Curler',
      contactEmail: 'alex.new@example.com',
      groupMembers: [{ name: 'Blair Curler', email: 'blair.new@example.com' }],
      fieldValues: [
        { fieldId: 10, registrationMemberIndex: null, value: 'Ice Breakers' },
        { fieldId: 11, registrationMemberIndex: 0, value: 'Large' },
        { fieldId: 11, registrationMemberIndex: 1, value: 'Small' },
      ],
    });

    expect(diffRegistrationFormSnapshots(before, after)).toEqual([
      {
        label: 'Email address',
        oldValue: 'alex@example.com',
        newValue: 'alex.new@example.com',
      },
      {
        label: 'Group member 1 email',
        oldValue: 'blair@example.com',
        newValue: 'blair.new@example.com',
      },
      {
        label: 'Shirt size (Group member 1)',
        oldValue: 'Medium',
        newValue: 'Small',
      },
    ]);
  });
});
