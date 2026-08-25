import path from 'path';
import { randomUUID } from 'crypto';
import { and, asc, desc, eq, gte, isNull, notInArray, or, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { ExpenseReportKind, ExpenseReportStatus, ExpenseTripPurpose } from '../db/drizzle-schema.js';
import { generateEventRegistrationAccessToken } from '../utils/eventRegistrationAccessToken.js';
import { expenseReportManageUrl } from '../utils/expenseReportManageUrl.js';
import { getFileStorageAdapter } from '../utils/fileStorage.js';
import { detectMimeType, sanitizeFilename } from '../utils/managedFiles.js';
import { config } from '../config.js';
import { formatDateInTimeZone, localDateTimeToUtcDate } from '../utils/timeZone.js';
import { normalizeEmail } from '../utils/auth.js';
import { volunteerCredentialIsValidOn } from '../utils/volunteerCredentials.js';
import {
  sendExpenseReportCheckMailedEmail,
  sendExpenseReportConfirmationEmail,
} from './email.js';
import {
  ALLOWED_RECEIPT_MIME_TYPES,
  CHARITABLE_MILEAGE_RATE_CENTS_PER_MILE,
  CLUB_CREDIT_CARD_HOLDER_CREDENTIAL_NAME,
  EXPENSE_STATUS_LABELS,
  MAX_EXPENSE_RECEIPTS,
} from './expenseReportConstants.js';
import {
  isSubmitterEditableStatus,
  shouldSendCheckMailedEmail,
  validateExpenseReportPayload,
  type ExpenseMailingAddressInput,
  type ExpenseReceiptInput,
  type ExpenseReportPayloadInput,
} from './expenseReportValidation.js';

export class ExpenseReportError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ExpenseReportError';
  }
}

export type ExpenseReceiptFileUpload = {
  index: number;
  originalFilename: string;
  mimeType: string;
  buffer: Buffer;
};

export type ExpenseReceiptView = {
  id: number;
  name: string;
  receiptDate: string;
  amountMinor: number;
  currency: string;
  currencyOther: string | null;
  includesDurableGood: boolean;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  sortOrder: number;
};

export type ExpenseReportNoteView = {
  id: number;
  authorName: string;
  body: string;
  createdAt: string;
};

export type ExpenseReportChangeView = {
  id: number;
  actorName: string;
  kind: 'fields' | 'status';
  summary: string;
  details: Array<{ field: string; from: string; to: string }> | null;
  createdAt: string;
};

export type ExpenseReportView = {
  id: number;
  kind: ExpenseReportKind;
  status: ExpenseReportStatus;
  statusLabel: string;
  memberId: number | null;
  submitterName: string;
  submitterEmail: string;
  submitterPhone: string | null;
  mailingAddress: ExpenseMailingAddressInput | null;
  committeeId: number | null;
  committeeName: string | null;
  committeeCustom: string | null;
  purpose: string | null;
  requestedAmountMinor: number;
  requestedCurrency: string;
  amountJustification: string | null;
  usedClubCreditCard: boolean | null;
  clubCreditCardOwnerMemberId: number | null;
  clubCreditCardOwnerName: string | null;
  comments: string | null;
  activityDate: string | null;
  fromKind: string | null;
  fromOther: string | null;
  toKind: string | null;
  toOther: string | null;
  roundTripMiles: number | null;
  tripPurpose: string | null;
  tripPurposeOther: string | null;
  receipts: ExpenseReceiptView[];
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  statusChangedByName?: string | null;
  statusChangedAt?: string | null;
  lastUpdatedByName?: string | null;
  notes?: ExpenseReportNoteView[];
  changes?: ExpenseReportChangeView[];
  manageUrl?: string;
  accessToken?: string;
};

export type StaffActor = { id: number; name: string };

export type ExpenseReportListItem = {
  id: number;
  kind: ExpenseReportKind;
  status: ExpenseReportStatus;
  statusLabel: string;
  submitterName: string;
  submitterEmail: string;
  requestedAmountMinor: number;
  requestedCurrency: string;
  submittedAt: string;
};

type ReportRow = Record<string, unknown>;
type ReceiptRow = Record<string, unknown>;

function asIso(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function asDateOnly(value: unknown): string | null {
  if (!value) return null;
  const raw = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  return raw.slice(0, 10) || null;
}

function asInt(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function asBool(value: unknown): boolean | null {
  if (value == null) return null;
  return value === 1 || value === true;
}

function mailingAddressFromRecord(parsed: Record<string, unknown>): ExpenseMailingAddressInput {
  const addressLine1 =
    (typeof parsed.addressLine1 === 'string' && parsed.addressLine1) ||
    (typeof parsed.street === 'string' && parsed.street) ||
    (typeof parsed.mailingAddressLine1 === 'string' && parsed.mailingAddressLine1) ||
    '';
  const addressLine2 =
    (typeof parsed.addressLine2 === 'string' && parsed.addressLine2) ||
    (typeof parsed.mailingAddressLine2 === 'string' && parsed.mailingAddressLine2) ||
    '';
  return {
    addressLine1,
    addressLine2,
    city:
      (typeof parsed.city === 'string' && parsed.city) ||
      (typeof parsed.mailingCity === 'string' && parsed.mailingCity) ||
      '',
    state:
      (typeof parsed.state === 'string' && parsed.state) ||
      (typeof parsed.mailingState === 'string' && parsed.mailingState) ||
      '',
    country:
      (typeof parsed.country === 'string' && parsed.country) ||
      (typeof parsed.mailingCountry === 'string' && parsed.mailingCountry) ||
      '',
    postalCode:
      (typeof parsed.postalCode === 'string' && parsed.postalCode) ||
      (typeof parsed.mailingPostalCode === 'string' && parsed.mailingPostalCode) ||
      '',
  };
}

function parseMailingAddress(raw: unknown): ExpenseMailingAddressInput | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const parsed = mailingAddressFromRecord(raw as Record<string, unknown>);
    return parsed.addressLine1 || parsed.city || parsed.postalCode ? parsed : null;
  }
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsedJson = JSON.parse(trimmed) as unknown;
    if (typeof parsedJson === 'object' && parsedJson !== null && !Array.isArray(parsedJson)) {
      const parsed = mailingAddressFromRecord(parsedJson as Record<string, unknown>);
      return parsed.addressLine1 || parsed.city || parsed.postalCode ? parsed : null;
    }
  } catch {
    // Fall through and treat the stored value as a single address line.
  }
  return {
    addressLine1: trimmed,
    addressLine2: '',
    city: '',
    state: '',
    country: '',
    postalCode: '',
  };
}

function serializeMailingAddress(address: ExpenseMailingAddressInput | null | undefined): string | null {
  if (!address) return null;
  return JSON.stringify({
    addressLine1: address.addressLine1.trim(),
    addressLine2: (address.addressLine2 ?? '').trim(),
    city: address.city.trim(),
    state: address.state.trim(),
    country: address.country.trim(),
    postalCode: address.postalCode.trim(),
  });
}

function createReceiptStorageKey(filename: string): string {
  const ext = path.extname(filename).toLowerCase().slice(0, 12);
  const ymd = new Date().toISOString().slice(0, 10);
  return `expense-receipts/${ymd}/${randomUUID()}${ext}`;
}

function mapReceipt(row: ReceiptRow): ExpenseReceiptView {
  return {
    id: asInt(row.id),
    name: String(row.name ?? ''),
    receiptDate: asDateOnly(row.receipt_date) ?? '',
    amountMinor: asInt(row.amount_minor),
    currency: String(row.currency ?? 'usd'),
    currencyOther: row.currency_other == null ? null : String(row.currency_other),
    includesDurableGood: asBool(row.includes_durable_good) === true,
    originalFilename: String(row.original_filename ?? ''),
    mimeType: String(row.mime_type ?? ''),
    byteSize: asInt(row.byte_size),
    sortOrder: asInt(row.sort_order),
  };
}

function mapReport(
  row: ReportRow,
  receipts: ReceiptRow[],
  options: {
    includeManage?: boolean;
    includeAdminReview?: boolean;
    notes?: ExpenseReportNoteView[];
    changes?: ExpenseReportChangeView[];
  } = {}
): ExpenseReportView {
  const status = String(row.status ?? 'pending_review') as ExpenseReportStatus;
  const accessToken = row.access_token ? String(row.access_token) : '';
  return {
    id: asInt(row.id),
    kind: String(row.kind) as ExpenseReportKind,
    status,
    statusLabel: EXPENSE_STATUS_LABELS[status] ?? status,
    memberId: row.member_id == null ? null : asInt(row.member_id),
    submitterName: String(row.submitter_name ?? ''),
    submitterEmail: String(row.submitter_email ?? ''),
    submitterPhone: row.submitter_phone == null ? null : String(row.submitter_phone),
    mailingAddress: parseMailingAddress(row.mailing_address),
    committeeId: row.committee_id == null ? null : asInt(row.committee_id),
    committeeName: row.committee_name == null ? null : String(row.committee_name),
    committeeCustom: row.committee_custom == null ? null : String(row.committee_custom),
    purpose: row.purpose == null ? null : String(row.purpose),
    requestedAmountMinor: asInt(row.requested_amount_minor),
    requestedCurrency: String(row.requested_currency ?? 'usd'),
    amountJustification: row.amount_justification == null ? null : String(row.amount_justification),
    usedClubCreditCard: asBool(row.used_club_credit_card),
    clubCreditCardOwnerMemberId:
      row.club_credit_card_owner_member_id == null ? null : asInt(row.club_credit_card_owner_member_id),
    clubCreditCardOwnerName:
      row.club_credit_card_owner_name == null ? null : String(row.club_credit_card_owner_name),
    comments: row.comments == null ? null : String(row.comments),
    activityDate: asDateOnly(row.activity_date),
    fromKind: row.from_kind == null ? null : String(row.from_kind),
    fromOther: row.from_other == null ? null : String(row.from_other),
    toKind: row.to_kind == null ? null : String(row.to_kind),
    toOther: row.to_other == null ? null : String(row.to_other),
    roundTripMiles: row.round_trip_miles == null ? null : Number(row.round_trip_miles),
    tripPurpose: row.trip_purpose == null ? null : String(row.trip_purpose),
    tripPurposeOther: row.trip_purpose_other == null ? null : String(row.trip_purpose_other),
    receipts: receipts.map(mapReceipt),
    submittedAt: asIso(row.submitted_at),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    canEdit: isSubmitterEditableStatus(status),
    ...(options.includeAdminReview
      ? {
          statusChangedByName: row.status_changed_by_name == null ? null : String(row.status_changed_by_name),
          statusChangedAt: row.status_changed_at ? asIso(row.status_changed_at) : null,
          lastUpdatedByName: row.last_updated_by_name == null ? null : String(row.last_updated_by_name),
          notes: options.notes ?? [],
          changes: options.changes ?? [],
        }
      : {}),
    manageUrl: options.includeManage && accessToken ? expenseReportManageUrl(accessToken) : undefined,
    accessToken: options.includeManage && accessToken ? accessToken : undefined,
  };
}

function mapListItem(row: ReportRow): ExpenseReportListItem {
  const status = String(row.status ?? 'pending_review') as ExpenseReportStatus;
  return {
    id: asInt(row.id),
    kind: String(row.kind) as ExpenseReportKind,
    status,
    statusLabel: EXPENSE_STATUS_LABELS[status] ?? status,
    submitterName: String(row.submitter_name ?? ''),
    submitterEmail: String(row.submitter_email ?? ''),
    requestedAmountMinor: asInt(row.requested_amount_minor),
    requestedCurrency: String(row.requested_currency ?? 'usd'),
    submittedAt: asIso(row.submitted_at),
  };
}

function throwIfInvalid(payload: ExpenseReportPayloadInput) {
  const errors = validateExpenseReportPayload(payload);
  if (errors.length > 0) {
    throw new ExpenseReportError('Please correct the highlighted fields.', 400, errors);
  }
}

type FieldSnapshot = Record<string, string>;

const FIELD_CHANGE_LABELS: Record<string, string> = {
  kind: 'Type',
  purpose: 'Purpose',
  committee: 'Committee',
  requestedAmount: 'Requested amount',
  amountJustification: 'Amount justification',
  comments: 'Comments',
  usedClubCreditCard: 'Club credit card',
  clubCreditCardOwner: 'Credit card owner',
  activityDate: 'Activity date',
  from: 'Starting location',
  to: 'Destination',
  roundTripMiles: 'Round trip miles',
  tripPurpose: 'Trip purpose',
  mailingAddress: 'Mailing address',
  receipts: 'Receipts',
};

function formatMinorMoney(amountMinor: number, currency = 'usd'): string {
  const code = /^[a-z]{3}$/i.test(currency) ? currency.toUpperCase() : 'USD';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(amountMinor / 100);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/** Convert stored change-log amounts like "1250 usd" into "$12.50". */
function formatStoredChangeAmount(value: string): string {
  const match = /^(-?\d+)\s+([a-z]{3})$/i.exec(value.trim());
  if (!match) return value;
  return formatMinorMoney(Number(match[1]), match[2]);
}

function snapshotReportFields(row: ReportRow, receipts: ReceiptRow[]): FieldSnapshot {
  const committee = String(row.committee_custom || row.committee_name || '');
  const fromKind = row.from_kind == null ? '' : String(row.from_kind);
  const fromOther = row.from_other == null ? '' : String(row.from_other);
  const toKind = row.to_kind == null ? '' : String(row.to_kind);
  const toOther = row.to_other == null ? '' : String(row.to_other);
  const usedCard = asBool(row.used_club_credit_card);
  return {
    kind: String(row.kind ?? ''),
    purpose: row.purpose == null ? '' : String(row.purpose),
    committee,
    requestedAmount: formatMinorMoney(
      asInt(row.requested_amount_minor),
      String(row.requested_currency ?? 'usd')
    ),
    amountJustification: row.amount_justification == null ? '' : String(row.amount_justification),
    comments: row.comments == null ? '' : String(row.comments),
    usedClubCreditCard: usedCard == null ? '' : usedCard ? 'yes' : 'no',
    clubCreditCardOwner: usedCard
      ? row.club_credit_card_owner_name == null
        ? ''
        : String(row.club_credit_card_owner_name)
      : '',
    activityDate: asDateOnly(row.activity_date) ?? '',
    from: fromKind === 'other' ? fromOther : fromKind,
    to: toKind === 'other' ? toOther : toKind,
    roundTripMiles: row.round_trip_miles == null ? '' : String(row.round_trip_miles),
    tripPurpose:
      String(row.trip_purpose ?? '') === 'other'
        ? String(row.trip_purpose_other ?? '')
        : String(row.trip_purpose ?? ''),
    mailingAddress: row.mailing_address == null ? '' : String(row.mailing_address),
    receipts: receipts
      .map((receipt) => {
        const name = String(receipt.name);
        const date = asDateOnly(receipt.receipt_date) ?? '';
        const amount = formatMinorMoney(asInt(receipt.amount_minor), String(receipt.currency ?? 'usd'));
        return date ? `${name} (${date}): ${amount}` : `${name}: ${amount}`;
      })
      .join('; '),
  };
}

function diffFieldSnapshots(
  before: FieldSnapshot,
  after: FieldSnapshot
): Array<{ field: string; from: string; to: string }> {
  const details: Array<{ field: string; from: string; to: string }> = [];
  for (const key of Object.keys(before)) {
    if (before[key] === after[key]) continue;
    details.push({
      field: FIELD_CHANGE_LABELS[key] ?? key,
      from: before[key],
      to: after[key],
    });
  }
  return details;
}

function summarizeFieldChanges(details: Array<{ field: string }>): string {
  if (details.length === 0) return 'Updated the expense report';
  const names = details.map((item) => item.field.toLowerCase());
  if (names.length === 1) return `Updated ${names[0]}`;
  if (names.length === 2) return `Updated ${names[0]} and ${names[1]}`;
  return `Updated ${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

async function insertExpenseReportChange(input: {
  reportId: number;
  actor: StaffActor;
  kind: 'fields' | 'status';
  summary: string;
  details?: Array<{ field: string; from: string; to: string }> | null;
}) {
  const { db, schema } = getDrizzleDb();
  await db.insert(schema.expenseReportChanges).values({
    report_id: input.reportId,
    actor_member_id: input.actor.id,
    actor_name: input.actor.name,
    kind: input.kind,
    summary: input.summary,
    details: input.details ? JSON.stringify(input.details) : null,
    created_at: new Date() as any,
  });
}

function mapNote(row: Record<string, unknown>): ExpenseReportNoteView {
  return {
    id: asInt(row.id),
    authorName: String(row.author_name ?? ''),
    body: String(row.body ?? ''),
    createdAt: asIso(row.created_at),
  };
}

function parseChangeDetails(raw: unknown): Array<{ field: string; from: string; to: string }> | null {
  if (raw == null || raw === '') return null;
  try {
    const parsed = JSON.parse(String(raw)) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter(
        (item): item is { field: string; from: string; to: string } =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof (item as { field?: unknown }).field === 'string'
      )
      .map((item) => {
        const field = item.field;
        const from = String(item.from ?? '');
        const to = String(item.to ?? '');
        if (field !== 'Requested amount') {
          return { field, from, to };
        }
        return {
          field,
          from: formatStoredChangeAmount(from),
          to: formatStoredChangeAmount(to),
        };
      });
  } catch {
    return null;
  }
}

function mapChange(row: Record<string, unknown>): ExpenseReportChangeView {
  return {
    id: asInt(row.id),
    actorName: String(row.actor_name ?? ''),
    kind: String(row.kind) === 'status' ? 'status' : 'fields',
    summary: String(row.summary ?? ''),
    details: parseChangeDetails(row.details),
    createdAt: asIso(row.created_at),
  };
}

async function loadNotes(reportId: number): Promise<ExpenseReportNoteView[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select()
    .from(schema.expenseReportNotes)
    .where(eq(schema.expenseReportNotes.report_id, reportId))
    .orderBy(asc(schema.expenseReportNotes.created_at), asc(schema.expenseReportNotes.id));
  return rows.map((row) => mapNote(row as Record<string, unknown>));
}

async function loadChanges(reportId: number): Promise<ExpenseReportChangeView[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select()
    .from(schema.expenseReportChanges)
    .where(eq(schema.expenseReportChanges.report_id, reportId))
    .orderBy(desc(schema.expenseReportChanges.created_at), desc(schema.expenseReportChanges.id));
  return rows.map((row) => mapChange(row as Record<string, unknown>));
}

function validateReceiptFile(upload: ExpenseReceiptFileUpload) {
  const filename = sanitizeFilename(upload.originalFilename || 'receipt.bin');
  const mimeType = detectMimeType(upload.mimeType, filename);
  if (!ALLOWED_RECEIPT_MIME_TYPES.has(mimeType)) {
    throw new ExpenseReportError('Receipt files must be PDF, JPEG, PNG, WebP, or HEIC.', 400, {
      field: `receipts.${upload.index}.file`,
    });
  }
  if (!upload.buffer.length) {
    throw new ExpenseReportError('Receipt file is empty.', 400, { field: `receipts.${upload.index}.file` });
  }
  return { filename, mimeType };
}

async function loadReceipts(reportId: number): Promise<ReceiptRow[]> {
  const { db, schema } = getDrizzleDb();
  return db
    .select()
    .from(schema.expenseReceipts)
    .where(eq(schema.expenseReceipts.report_id, reportId))
    .orderBy(asc(schema.expenseReceipts.sort_order), asc(schema.expenseReceipts.id)) as Promise<ReceiptRow[]>;
}

async function loadReportRow(id: number): Promise<ReportRow | null> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db.select().from(schema.expenseReports).where(eq(schema.expenseReports.id, id)).limit(1);
  return (row as ReportRow | undefined) ?? null;
}

export async function memberHoldsClubCreditCard(memberId: number): Promise<boolean> {
  const { db, schema } = getDrizzleDb();
  const today = new Date().toISOString().slice(0, 10);
  const grants = await db
    .select({
      expiresAt: schema.memberVolunteerCredentials.expires_at,
    })
    .from(schema.memberVolunteerCredentials)
    .innerJoin(
      schema.volunteerCredentials,
      eq(schema.volunteerCredentials.id, schema.memberVolunteerCredentials.credential_id)
    )
    .where(
      and(
        eq(schema.memberVolunteerCredentials.member_id, memberId),
        sql`lower(${schema.volunteerCredentials.name}) = lower(${CLUB_CREDIT_CARD_HOLDER_CREDENTIAL_NAME})`
      )
    );
  return grants.some((grant) =>
    volunteerCredentialIsValidOn(
      grant.expiresAt == null ? null : String(grant.expiresAt).slice(0, 10),
      today
    )
  );
}

async function clubName(): Promise<string> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({ clubName: schema.siteConfig.club_name })
    .from(schema.siteConfig)
    .limit(1);
  return row?.clubName?.trim() || 'Triangle Curling';
}

export async function getExpenseFormOptions(memberId: number | null) {
  const { db, schema } = getDrizzleDb();
  const committees = await db
    .select({
      id: schema.governanceCommittees.id,
      name: schema.governanceCommittees.name,
    })
    .from(schema.governanceCommittees)
    .orderBy(asc(schema.governanceCommittees.sort_order), asc(schema.governanceCommittees.name));

  let submitterPrefill: {
    name: string;
    email: string | null;
    phone: string | null;
    mailingAddress: ExpenseMailingAddressInput | null;
  } | null = null;
  let isClubCreditCardHolder = false;

  if (memberId) {
    const [member] = await db
      .select({
        name: schema.members.name,
        email: schema.members.email,
        phone: schema.members.phone,
        mailingAddress: schema.members.mailing_address,
      })
      .from(schema.members)
      .where(eq(schema.members.id, memberId))
      .limit(1);
    if (member) {
      submitterPrefill = {
        name: member.name,
        email: member.email,
        phone: member.phone,
        mailingAddress: parseMailingAddress(member.mailingAddress),
      };
    }
    isClubCreditCardHolder = await memberHoldsClubCreditCard(memberId);
  }

  return {
    committees,
    clubName: await clubName(),
    mileageRateCentsPerMile: CHARITABLE_MILEAGE_RATE_CENTS_PER_MILE,
    isClubCreditCardHolder,
    submitterPrefill,
  };
}

async function resolveCommitteeSnapshot(committeeId: number | null, committeeCustom: string | null) {
  if (!committeeId) {
    return { committeeId: null, committeeName: committeeCustom?.trim() || null, committeeCustom: committeeCustom?.trim() || null };
  }
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({ id: schema.governanceCommittees.id, name: schema.governanceCommittees.name })
    .from(schema.governanceCommittees)
    .where(eq(schema.governanceCommittees.id, committeeId))
    .limit(1);
  if (!row) {
    throw new ExpenseReportError('Select a valid committee.', 400, [{ field: 'committee', message: 'Select a valid committee.' }]);
  }
  return {
    committeeId: row.id,
    committeeName: row.name,
    committeeCustom: committeeCustom?.trim() || null,
  };
}

function reportValuesFromPayload(
  payload: ExpenseReportPayloadInput,
  committee: { committeeId: number | null; committeeName: string | null; committeeCustom: string | null },
  memberId: number | null,
  options: { defaultCardOwnerToSubmitter?: boolean } = {}
) {
  const usedCard =
    payload.usedClubCreditCard == null ? null : payload.usedClubCreditCard ? 1 : 0;
  return {
    kind: payload.kind,
    member_id: memberId,
    submitter_name: payload.submitterName.trim(),
    submitter_email: normalizeEmail(payload.submitterEmail),
    submitter_phone: payload.submitterPhone?.trim() || null,
    mailing_address: serializeMailingAddress(payload.mailingAddress ?? null),
    committee_id: committee.committeeId,
    committee_name: committee.committeeName,
    committee_custom: committee.committeeCustom,
    purpose: payload.purpose?.trim() || null,
    requested_amount_minor: payload.requestedAmountMinor,
    requested_currency: (payload.requestedCurrency || 'usd').toLowerCase(),
    amount_justification: payload.amountJustification?.trim() || null,
    used_club_credit_card: usedCard,
    club_credit_card_owner_member_id:
      usedCard === 1
        ? payload.clubCreditCardOwnerMemberId ?? (options.defaultCardOwnerToSubmitter ? memberId : null)
        : null,
    club_credit_card_owner_name:
      usedCard === 1 ? payload.clubCreditCardOwnerName?.trim() || payload.submitterName.trim() : null,
    comments: payload.comments?.trim() || null,
    activity_date: payload.activityDate || null,
    from_kind: payload.fromKind || null,
    from_other: payload.fromOther?.trim() || null,
    to_kind: payload.toKind || null,
    to_other: payload.toOther?.trim() || null,
    round_trip_miles: payload.roundTripMiles ?? null,
    trip_purpose: (payload.tripPurpose as ExpenseTripPurpose | null) || null,
    trip_purpose_other: payload.tripPurposeOther?.trim() || null,
    updated_at: new Date() as any,
  };
}

async function insertReceipt(
  reportId: number,
  receipt: ExpenseReceiptInput,
  upload: ExpenseReceiptFileUpload,
  sortOrder: number
) {
  const { db, schema } = getDrizzleDb();
  const storage = getFileStorageAdapter();
  const { filename, mimeType } = validateReceiptFile(upload);
  const storageKey = createReceiptStorageKey(filename);
  await storage.put(storageKey, upload.buffer);
  await db.insert(schema.expenseReceipts).values({
    report_id: reportId,
    name: receipt.name.trim(),
    receipt_date: receipt.receiptDate,
    amount_minor: receipt.amountMinor,
    currency: receipt.currency,
    currency_other: receipt.currencyOther?.trim() || null,
    includes_durable_good: receipt.includesDurableGood ? 1 : 0,
    storage_key: storageKey,
    original_filename: filename,
    mime_type: mimeType,
    byte_size: upload.buffer.length,
    sort_order: sortOrder,
    updated_at: new Date() as any,
  });
}

async function storeReceipts(
  reportId: number,
  receipts: ExpenseReceiptInput[],
  filesByIndex: Map<number, ExpenseReceiptFileUpload>
) {
  for (let index = 0; index < receipts.length; index += 1) {
    const receipt = receipts[index];
    const upload = filesByIndex.get(index);
    if (!upload) {
      throw new ExpenseReportError('Upload a receipt file.', 400, { field: `receipts.${index}.file` });
    }
    await insertReceipt(reportId, receipt, upload, index);
  }
}

export async function createExpenseReport(options: {
  payload: ExpenseReportPayloadInput;
  files: ExpenseReceiptFileUpload[];
  memberId: number | null;
}): Promise<ExpenseReportView> {
  const askClubCreditCard = options.memberId
    ? await memberHoldsClubCreditCard(options.memberId)
    : false;
  const payload = { ...options.payload, askClubCreditCard };
  throwIfInvalid(payload);
  if (payload.kind === 'expense' && options.files.length > MAX_EXPENSE_RECEIPTS) {
    throw new ExpenseReportError(`You can attach up to ${MAX_EXPENSE_RECEIPTS} receipts.`, 400);
  }

  const filesByIndex = new Map(options.files.map((file) => [file.index, file]));
  const committee = payload.kind === 'expense'
    ? await resolveCommitteeSnapshot(payload.committeeId ?? null, payload.committeeCustom ?? null)
    : { committeeId: null, committeeName: null, committeeCustom: null };

  const accessToken = generateEventRegistrationAccessToken();
  const { db, schema } = getDrizzleDb();
  const now = new Date() as any;
  const inserted = await db
    .insert(schema.expenseReports)
    .values({
      ...reportValuesFromPayload(payload, committee, options.memberId, {
        defaultCardOwnerToSubmitter: true,
      }),
      status: 'pending_review',
      access_token: accessToken,
      submitted_at: now,
      created_at: now,
    })
    .returning({ id: schema.expenseReports.id });
  const reportId = inserted[0].id;

  if (payload.kind === 'expense') {
    await storeReceipts(reportId, payload.receipts, filesByIndex);
  }

  const row = await loadReportRow(reportId);
  const receipts = await loadReceipts(reportId);
  const view = mapReport(row!, receipts, { includeManage: true });
  const club = await clubName();
  await sendExpenseReportConfirmationEmail({
    to: view.submitterEmail,
    recipientName: view.submitterName,
    report: view,
    clubName: club,
    manageUrl: view.manageUrl ?? expenseReportManageUrl(accessToken),
  });
  return view;
}

async function requireEditable(row: ReportRow) {
  const status = String(row.status ?? 'pending_review') as ExpenseReportStatus;
  if (!isSubmitterEditableStatus(status)) {
    throw new ExpenseReportError('This report can no longer be changed.', 403);
  }
}

export type ExpenseReceiptUpdateInput = ExpenseReceiptInput & { id?: number };

export async function updateExpenseReportRecord(options: {
  reportId: number;
  payload: ExpenseReportPayloadInput;
  files: ExpenseReceiptFileUpload[];
  removeReceiptIds?: number[];
  memberId: number | null;
  skipEditableCheck?: boolean;
  staffActor?: StaffActor;
}): Promise<ExpenseReportView> {
  const existing = await loadReportRow(options.reportId);
  if (!existing) throw new ExpenseReportError('Expense report not found.', 404);
  if (!options.skipEditableCheck) {
    await requireEditable(existing);
  }
  const existingReceipts = await loadReceipts(options.reportId);
  const beforeSnapshot = options.staffActor ? snapshotReportFields(existing, existingReceipts) : null;

  const ownerMemberId =
    existing.member_id == null ? options.memberId : asInt(existing.member_id);
  const askClubCreditCard = options.staffActor
    ? options.payload.kind === 'expense'
    : existing.used_club_credit_card != null ||
      (ownerMemberId != null && (await memberHoldsClubCreditCard(ownerMemberId)));
  const payload = { ...options.payload, askClubCreditCard };
  throwIfInvalid(payload);

  const committee = payload.kind === 'expense'
    ? await resolveCommitteeSnapshot(payload.committeeId ?? null, payload.committeeCustom ?? null)
    : { committeeId: null, committeeName: null, committeeCustom: null };

  const { db, schema } = getDrizzleDb();
  const nextValues = {
    ...reportValuesFromPayload(payload, committee, ownerMemberId, {
      defaultCardOwnerToSubmitter: !options.staffActor,
    }),
    ...(options.staffActor
      ? {
          last_updated_by_member_id: options.staffActor.id,
          last_updated_by_name: options.staffActor.name,
        }
      : {}),
  };
  await db
    .update(schema.expenseReports)
    .set(nextValues)
    .where(eq(schema.expenseReports.id, options.reportId));

  if (payload.kind === 'expense') {
    const currentReceipts = await loadReceipts(options.reportId);
    const removeIds = new Set(options.removeReceiptIds ?? []);
    const storage = getFileStorageAdapter();
    for (const receipt of currentReceipts) {
      if (removeIds.has(asInt(receipt.id))) {
        try {
          await storage.delete(String(receipt.storage_key));
        } catch {
          // continue even if the file is already gone
        }
        await db.delete(schema.expenseReceipts).where(eq(schema.expenseReceipts.id, asInt(receipt.id)));
      }
    }

    const filesByIndex = new Map(options.files.map((file) => [file.index, file]));
    const remaining = await loadReceipts(options.reportId);
    const remainingById = new Map(remaining.map((row) => [asInt(row.id), row]));

    for (let index = 0; index < payload.receipts.length; index += 1) {
      const receipt = payload.receipts[index] as ExpenseReceiptUpdateInput;
      const upload = filesByIndex.get(index);
      if (receipt.id && remainingById.has(receipt.id)) {
        const updates: Record<string, unknown> = {
          name: receipt.name.trim(),
          receipt_date: receipt.receiptDate,
          amount_minor: receipt.amountMinor,
          currency: receipt.currency,
          currency_other: receipt.currencyOther?.trim() || null,
          includes_durable_good: receipt.includesDurableGood ? 1 : 0,
          sort_order: index,
          updated_at: new Date() as any,
        };
        if (upload) {
          const { filename, mimeType } = validateReceiptFile(upload);
          const storageKey = createReceiptStorageKey(filename);
          await storage.put(storageKey, upload.buffer);
          try {
            await storage.delete(String(remainingById.get(receipt.id)?.storage_key));
          } catch {
            // ignore missing old file
          }
          updates.storage_key = storageKey;
          updates.original_filename = filename;
          updates.mime_type = mimeType;
          updates.byte_size = upload.buffer.length;
        }
        await db
          .update(schema.expenseReceipts)
          .set(updates)
          .where(eq(schema.expenseReceipts.id, receipt.id));
      } else {
        if (!upload) {
          throw new ExpenseReportError('Upload a receipt file.', 400, { field: `receipts.${index}.file` });
        }
        await insertReceipt(options.reportId, receipt, upload, index);
      }
    }
  }

  const row = await loadReportRow(options.reportId);
  const receipts = await loadReceipts(options.reportId);
  if (options.staffActor && beforeSnapshot) {
    const details = diffFieldSnapshots(beforeSnapshot, snapshotReportFields(row!, receipts));
    if (details.length > 0) {
      await insertExpenseReportChange({
        reportId: options.reportId,
        actor: options.staffActor,
        kind: 'fields',
        summary: summarizeFieldChanges(details),
        details,
      });
    }
  }
  return options.staffActor
    ? getExpenseReportForAdmin(options.reportId)
    : mapReport(row!, receipts);
}

function memberOwnsReport(row: ReportRow, member: { id: number; email: string | null }): boolean {
  if (row.member_id != null && asInt(row.member_id) === member.id) return true;
  if (row.member_id == null && member.email && normalizeEmail(String(row.submitter_email ?? '')) === normalizeEmail(member.email)) {
    return true;
  }
  return false;
}

export async function getExpenseReportByAccessToken(accessToken: string): Promise<ExpenseReportView> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select()
    .from(schema.expenseReports)
    .where(eq(schema.expenseReports.access_token, accessToken.trim()))
    .limit(1);
  if (!row) throw new ExpenseReportError('Expense report not found.', 404);
  const receipts = await loadReceipts(asInt(row.id));
  return mapReport(row as ReportRow, receipts);
}

export async function getExpenseReportForMember(
  reportId: number,
  member: { id: number; email: string | null }
): Promise<ExpenseReportView> {
  const row = await loadReportRow(reportId);
  if (!row || !memberOwnsReport(row, member)) {
    throw new ExpenseReportError('Expense report not found.', 404);
  }
  const receipts = await loadReceipts(reportId);
  return mapReport(row, receipts);
}

export async function getExpenseReportForAdmin(reportId: number): Promise<ExpenseReportView> {
  const row = await loadReportRow(reportId);
  if (!row) throw new ExpenseReportError('Expense report not found.', 404);
  const [receipts, notes, changes] = await Promise.all([
    loadReceipts(reportId),
    loadNotes(reportId),
    loadChanges(reportId),
  ]);
  return mapReport(row, receipts, {
    includeManage: true,
    includeAdminReview: true,
    notes,
    changes,
  });
}

export async function listExpenseReportsForMember(
  member: { id: number; email: string | null },
  query: { page?: number; pageSize?: number } = {}
) {
  const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), 100);
  const page = Math.max(query.page ?? 1, 1);
  const offset = (page - 1) * pageSize;
  const { db, schema } = getDrizzleDb();
  const email = member.email ? normalizeEmail(member.email) : '';
  const ownerFilter = email
    ? or(
        eq(schema.expenseReports.member_id, member.id),
        and(isNull(schema.expenseReports.member_id), eq(schema.expenseReports.submitter_email, email))
      )
    : eq(schema.expenseReports.member_id, member.id);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.expenseReports)
    .where(ownerFilter);
  const total = Number(countRow?.count ?? 0);
  const rows = await db
    .select()
    .from(schema.expenseReports)
    .where(ownerFilter)
    .orderBy(desc(schema.expenseReports.submitted_at), desc(schema.expenseReports.id))
    .limit(pageSize)
    .offset(offset);
  return {
    items: rows.map((row) => mapListItem(row as ReportRow)),
    page,
    pageSize,
    total,
  };
}

export async function listExpenseReportsForAdmin(query: {
  page?: number;
  pageSize?: number;
  status?: ExpenseReportStatus | '';
  search?: string;
}) {
  const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), 100);
  const page = Math.max(query.page ?? 1, 1);
  const offset = (page - 1) * pageSize;
  const { db, schema } = getDrizzleDb();
  const filters = [];
  if (query.status) {
    filters.push(eq(schema.expenseReports.status, query.status));
  }
  const search = query.search?.trim();
  if (search) {
    const like = `%${search.toLowerCase()}%`;
    filters.push(
      or(
        sql`lower(${schema.expenseReports.submitter_name}) like ${like}`,
        sql`lower(${schema.expenseReports.submitter_email}) like ${like}`
      )
    );
  }
  const where = filters.length ? and(...filters) : undefined;
  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.expenseReports)
    .where(where);
  const total = Number(countRow?.count ?? 0);
  const rows = await db
    .select()
    .from(schema.expenseReports)
    .where(where)
    .orderBy(desc(schema.expenseReports.submitted_at), desc(schema.expenseReports.id))
    .limit(pageSize)
    .offset(offset);
  return {
    items: rows.map((row) => mapListItem(row as ReportRow)),
    page,
    pageSize,
    total,
  };
}

export async function updateExpenseReportAdmin(
  reportId: number,
  patch: { status?: ExpenseReportStatus },
  actor: StaffActor
): Promise<ExpenseReportView> {
  const existing = await loadReportRow(reportId);
  if (!existing) throw new ExpenseReportError('Expense report not found.', 404);
  const previousStatus = String(existing.status) as ExpenseReportStatus;
  const nextStatus = patch.status ?? previousStatus;
  const { db, schema } = getDrizzleDb();
  const statusChanged = nextStatus !== previousStatus;
  await db
    .update(schema.expenseReports)
    .set({
      status: nextStatus,
      updated_at: new Date() as any,
      ...(statusChanged
        ? {
            status_changed_by_member_id: actor.id,
            status_changed_by_name: actor.name,
            status_changed_at: new Date() as any,
          }
        : {}),
    })
    .where(eq(schema.expenseReports.id, reportId));

  if (statusChanged) {
    await insertExpenseReportChange({
      reportId,
      actor,
      kind: 'status',
      summary: `Changed status from ${EXPENSE_STATUS_LABELS[previousStatus] ?? previousStatus} to ${EXPENSE_STATUS_LABELS[nextStatus] ?? nextStatus}`,
      details: [
        {
          field: 'Status',
          from: EXPENSE_STATUS_LABELS[previousStatus] ?? previousStatus,
          to: EXPENSE_STATUS_LABELS[nextStatus] ?? nextStatus,
        },
      ],
    });
  }

  if (shouldSendCheckMailedEmail(previousStatus, nextStatus)) {
    const receipts = await loadReceipts(reportId);
    const view = mapReport({ ...existing, status: nextStatus }, receipts, { includeManage: true });
    const accessToken = String(existing.access_token ?? '');
    await sendExpenseReportCheckMailedEmail({
      to: view.submitterEmail,
      recipientName: view.submitterName,
      manageUrl: accessToken ? expenseReportManageUrl(accessToken) : undefined,
    });
  }

  return getExpenseReportForAdmin(reportId);
}

export async function addExpenseReportNote(
  reportId: number,
  body: string,
  actor: StaffActor
): Promise<ExpenseReportView> {
  const existing = await loadReportRow(reportId);
  if (!existing) throw new ExpenseReportError('Expense report not found.', 404);
  const trimmed = body.trim();
  if (!trimmed) {
    throw new ExpenseReportError('Enter a note.', 400, { field: 'body' });
  }
  if (trimmed.length > 8000) {
    throw new ExpenseReportError('Notes must be 8,000 characters or fewer.', 400, { field: 'body' });
  }
  const { db, schema } = getDrizzleDb();
  await db.insert(schema.expenseReportNotes).values({
    report_id: reportId,
    author_member_id: actor.id,
    author_name: actor.name,
    body: trimmed,
    created_at: new Date() as any,
  });
  return getExpenseReportForAdmin(reportId);
}

export type ExpenseAdminSummary = {
  unprocessedCount: number;
  awaitingReimbursementCount: number;
  monthToDateAmountMinor: number;
};

export async function getExpenseAdminSummary(): Promise<ExpenseAdminSummary> {
  const { db, schema } = getDrizzleDb();
  const timeZone = config.timeZone || 'America/New_York';
  const todayLocal = formatDateInTimeZone(new Date(), timeZone) ?? new Date().toISOString().slice(0, 10);
  const monthStartLocal = `${todayLocal.slice(0, 7)}-01`;
  const monthStartUtc = localDateTimeToUtcDate(monthStartLocal, '00:00:00', timeZone);

  const [unprocessedRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.expenseReports)
    .where(eq(schema.expenseReports.status, 'pending_review'));

  const awaitingWhere = and(
    notInArray(schema.expenseReports.status, ['check_mailed', 'complete']),
    or(
      eq(schema.expenseReports.kind, 'mileage'),
      sql`coalesce(${schema.expenseReports.used_club_credit_card}, 0) = 0`
    )
  );
  const [awaitingRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.expenseReports)
    .where(awaitingWhere);

  const [monthRow] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.expenseReports.requested_amount_minor}), 0)` })
    .from(schema.expenseReports)
    .where(gte(schema.expenseReports.submitted_at, monthStartUtc as any));

  return {
    unprocessedCount: Number(unprocessedRow?.count ?? 0),
    awaitingReimbursementCount: Number(awaitingRow?.count ?? 0),
    monthToDateAmountMinor: Number(monthRow?.total ?? 0),
  };
}

export type ExpenseReceiptFile = {
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  storageKey: string;
};

async function receiptFile(reportId: number, receiptId: number): Promise<ExpenseReceiptFile> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select()
    .from(schema.expenseReceipts)
    .where(and(eq(schema.expenseReceipts.id, receiptId), eq(schema.expenseReceipts.report_id, reportId)))
    .limit(1);
  if (!row) throw new ExpenseReportError('Receipt not found.', 404);
  return {
    originalFilename: String(row.original_filename),
    mimeType: String(row.mime_type),
    byteSize: asInt(row.byte_size),
    storageKey: String(row.storage_key),
  };
}

export async function getExpenseReceiptFileByAccessToken(
  accessToken: string,
  receiptId: number
): Promise<ExpenseReceiptFile> {
  const report = await getExpenseReportByAccessToken(accessToken);
  return receiptFile(report.id, receiptId);
}

export async function getExpenseReceiptFileForMember(
  reportId: number,
  receiptId: number,
  member: { id: number; email: string | null }
): Promise<ExpenseReceiptFile> {
  await getExpenseReportForMember(reportId, member);
  return receiptFile(reportId, receiptId);
}

export async function getExpenseReceiptFileForAdmin(
  reportId: number,
  receiptId: number
): Promise<ExpenseReceiptFile> {
  await getExpenseReportForAdmin(reportId);
  return receiptFile(reportId, receiptId);
}

export async function streamExpenseReceiptFile(
  file: ExpenseReceiptFile,
  reply: { header: (k: string, v: string) => void; send: (v: unknown) => unknown }
) {
  const storage = getFileStorageAdapter();
  const downloadName = sanitizeFilename(file.originalFilename);
  reply.header('Content-Type', file.mimeType);
  reply.header('Content-Length', String(file.byteSize));
  reply.header('Cache-Control', 'private, max-age=0, must-revalidate');
  reply.header('Content-Disposition', `inline; filename="${downloadName}"`);
  const stream = await storage.getReadStream(file.storageKey);
  return reply.send(stream);
}
