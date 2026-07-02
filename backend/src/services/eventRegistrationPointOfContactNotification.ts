import { splitMemberDisplayName } from '../utils/memberName.js';
import { isSubheadingFieldType } from './eventRegistrationFieldDefinitions.js';
import {
  sendEventPointOfContactRegistrationCancelledEmail,
  sendEventPointOfContactRegistrationUpdatedEmail,
  sendEventPointOfContactNewRegistrationEmail,
  type EventRegistrationFormEmailRow,
  type EventRegistrationFormFieldChange,
} from './email.js';
import { getRegistrationForEvent } from './eventService.js';
import type { UpsertEventRegistrationInput } from './eventService.js';

type EventRegistrationField = {
  id: number;
  label: string;
  field_type: string;
  scope: string;
  sort_order?: number;
};

type EventWithRegistrationFields = {
  id: number;
  title: string;
  point_of_contact: string;
  registrationFields?: EventRegistrationField[] | unknown[];
};

type DbRegistration = {
  contact_name?: string | null;
  contact_email?: string | null;
  groupMembers?: Array<{ id?: number; name: string; email?: string | null; sort_order?: number }>;
  fieldValues?: Array<{ field_id: number; registration_member_id: number | null; value: string | null }>;
};

export type RegistrationFormSnapshot = {
  rows: EventRegistrationFormEmailRow[];
};

function personLabel(index: number): string {
  return index === 0 ? 'Primary registrant' : `Group member ${index}`;
}

function normalizeDisplayValue(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : '(empty)';
}

function sortedRegistrationFields(event: EventWithRegistrationFields): EventRegistrationField[] {
  return [...(event.registrationFields ?? [])]
    .filter((field): field is EventRegistrationField => {
      return (
        typeof field === 'object' &&
        field !== null &&
        typeof (field as EventRegistrationField).id === 'number' &&
        typeof (field as EventRegistrationField).label === 'string' &&
        typeof (field as EventRegistrationField).field_type === 'string' &&
        typeof (field as EventRegistrationField).scope === 'string'
      );
    })
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id);
}

function fieldValueKey(fieldId: number, memberIndex: number | null): string {
  return `field:${fieldId}:${memberIndex ?? 'group'}`;
}

function buildFieldRows(
  event: EventWithRegistrationFields,
  fieldValues: Array<{ fieldId: number; registrationMemberIndex?: number | null; value: string | null | undefined }>,
  groupMemberCount: number,
): EventRegistrationFormEmailRow[] {
  const fields = sortedRegistrationFields(event);
  const valueByKey = new Map<string, string>();
  for (const fv of fieldValues) {
    const field = fields.find((f) => f.id === fv.fieldId);
    if (!field || isSubheadingFieldType(field.field_type)) continue;
    const memberIndex = field.scope === 'individual' ? (fv.registrationMemberIndex ?? 0) : null;
    valueByKey.set(fieldValueKey(fv.fieldId, memberIndex), fv.value ?? '');
  }

  const rows: EventRegistrationFormEmailRow[] = [];
  const totalPeople = 1 + groupMemberCount;

  for (const field of fields) {
    if (isSubheadingFieldType(field.field_type)) continue;

    if (field.scope === 'individual') {
      for (let index = 0; index < totalPeople; index += 1) {
        const key = fieldValueKey(field.id, index);
        rows.push({
          key,
          label: `${field.label} (${personLabel(index)})`,
          value: normalizeDisplayValue(valueByKey.get(key)),
        });
      }
    } else {
      const key = fieldValueKey(field.id, null);
      rows.push({
        key,
        label: field.label,
        value: normalizeDisplayValue(valueByKey.get(key)),
      });
    }
  }

  return rows;
}

export function buildRegistrationFormSnapshot(
  event: EventWithRegistrationFields,
  contact: { firstName: string; lastName: string; email: string },
  groupMembers: Array<{ name: string; email?: string | null }>,
  fieldValues: Array<{ fieldId: number; registrationMemberIndex?: number | null; value: string | null | undefined }>,
): RegistrationFormSnapshot {
  const rows: EventRegistrationFormEmailRow[] = [
    { key: 'contact:firstName', label: 'First name', value: normalizeDisplayValue(contact.firstName) },
    { key: 'contact:lastName', label: 'Last name', value: normalizeDisplayValue(contact.lastName) },
    { key: 'contact:email', label: 'Email address', value: normalizeDisplayValue(contact.email) },
  ];

  groupMembers.forEach((member, index) => {
    rows.push({
      key: `groupMember:${index}:name`,
      label: `${personLabel(index + 1)} name`,
      value: normalizeDisplayValue(member.name),
    });
    rows.push({
      key: `groupMember:${index}:email`,
      label: `${personLabel(index + 1)} email`,
      value: normalizeDisplayValue(member.email),
    });
  });

  rows.push(...buildFieldRows(event, fieldValues, groupMembers.length));

  return { rows };
}

export function buildRegistrationFormSnapshotFromRegistration(
  event: EventWithRegistrationFields,
  registration: DbRegistration,
): RegistrationFormSnapshot {
  const { firstName, lastName } = splitMemberDisplayName(registration.contact_name ?? '');
  const sortedMembers = [...(registration.groupMembers ?? [])].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );
  const memberIndexById = new Map<number, number>();
  sortedMembers.forEach((member, idx) => {
    if (member.id != null) memberIndexById.set(member.id, idx + 1);
  });

  const fieldValues = (registration.fieldValues ?? []).map((fv) => ({
    fieldId: fv.field_id,
    registrationMemberIndex:
      fv.registration_member_id == null
        ? null
        : (memberIndexById.get(fv.registration_member_id) ?? null),
    value: fv.value,
  }));

  return buildRegistrationFormSnapshot(
    event,
    {
      firstName,
      lastName,
      email: registration.contact_email ?? '',
    },
    sortedMembers.map((member) => ({ name: member.name, email: member.email })),
    fieldValues,
  );
}

export function buildRegistrationFormSnapshotFromInput(
  event: EventWithRegistrationFields,
  input: UpsertEventRegistrationInput,
): RegistrationFormSnapshot {
  return buildRegistrationFormSnapshot(
    event,
    {
      firstName: input.contactFirstName,
      lastName: input.contactLastName,
      email: input.contactEmail,
    },
    (input.groupMembers ?? []).map((member) => ({ name: member.name, email: member.email })),
    (input.fieldValues ?? []).map((fv) => ({
      fieldId: fv.fieldId,
      registrationMemberIndex: fv.registrationMemberIndex ?? null,
      value: fv.value,
    })),
  );
}

export function diffRegistrationFormSnapshots(
  before: RegistrationFormSnapshot,
  after: RegistrationFormSnapshot,
): EventRegistrationFormFieldChange[] {
  const beforeByKey = new Map(before.rows.map((row) => [row.key, row]));
  const afterByKey = new Map(after.rows.map((row) => [row.key, row]));
  const orderedKeys = [...after.rows.map((row) => row.key)];
  for (const row of before.rows) {
    if (!afterByKey.has(row.key)) orderedKeys.push(row.key);
  }

  const changes: EventRegistrationFormFieldChange[] = [];
  for (const key of orderedKeys) {
    const oldRow = beforeByKey.get(key);
    const newRow = afterByKey.get(key);
    const oldValue = oldRow?.value ?? '(empty)';
    const newValue = newRow?.value ?? '(empty)';
    if (oldValue === newValue) continue;
    changes.push({
      label: newRow?.label ?? oldRow?.label ?? key,
      oldValue,
      newValue,
    });
  }
  return changes;
}

function formatRegistrationStatus(status: string): string {
  switch (status) {
    case 'confirmed':
      return 'Confirmed';
    case 'pending_payment':
      return 'Pending payment';
    case 'waitlisted':
      return 'Waitlisted';
    case 'cancelled':
      return 'Canceled';
    default:
      return status;
  }
}

/** Free registrations that are complete without checkout (confirmed or waitlisted). */
export function shouldNotifyPointOfContactAtRegistration(input: {
  needsPayment: boolean;
  status: string;
}): boolean {
  return !input.needsPayment && (input.status === 'confirmed' || input.status === 'waitlisted');
}

export async function notifyPointOfContactOfNewRegistration(input: {
  event: EventWithRegistrationFields;
  registrationId: number;
  status: string;
}): Promise<void> {
  const pointOfContact = input.event.point_of_contact?.trim();
  if (!pointOfContact) return;

  const registration = await getRegistrationForEvent(input.event.id, input.registrationId);
  if (!registration) return;

  const snapshot = buildRegistrationFormSnapshotFromRegistration(input.event, registration);
  const registrantName = registration.contact_name?.trim() || 'Registrant';

  await sendEventPointOfContactNewRegistrationEmail(
    pointOfContact,
    input.event.title,
    registrantName,
    registration.contact_email ?? '',
    formatRegistrationStatus(input.status),
    snapshot.rows,
  );
}

export async function notifyPointOfContactOfRegistrationUpdate(input: {
  event: EventWithRegistrationFields;
  registration: DbRegistration & { contact_name?: string | null; contact_email?: string | null };
  changes: EventRegistrationFormFieldChange[];
}): Promise<void> {
  const pointOfContact = input.event.point_of_contact?.trim();
  if (!pointOfContact || input.changes.length === 0) return;

  const registrantName = input.registration.contact_name?.trim() || 'Registrant';

  await sendEventPointOfContactRegistrationUpdatedEmail(
    pointOfContact,
    input.event.title,
    registrantName,
    input.registration.contact_email ?? '',
    input.changes,
  );
}

export async function notifyPointOfContactOfRegistrationCancellation(input: {
  event: EventWithRegistrationFields;
  registration: DbRegistration & { contact_name?: string | null; contact_email?: string | null };
}): Promise<void> {
  const pointOfContact = input.event.point_of_contact?.trim();
  if (!pointOfContact) return;

  const snapshot = buildRegistrationFormSnapshotFromRegistration(input.event, input.registration);
  const registrantName = input.registration.contact_name?.trim() || 'Registrant';

  await sendEventPointOfContactRegistrationCancelledEmail(
    pointOfContact,
    input.event.title,
    registrantName,
    input.registration.contact_email ?? '',
    snapshot.rows,
  );
}
