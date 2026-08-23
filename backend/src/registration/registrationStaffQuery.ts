import {
  and,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  ne,
  not,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { PREFERRED_PRONOUN_PRESET_VALUES } from '../utils/preferredPronouns.js';
import { USA_CURLING_COMPETITION_GENDER_OPTIONS } from '../utils/usaCurlingCompetitionGender.js';
import { addYears } from './registrationAgeExperience.js';
import { DRAFT_REGISTRATION_STATUSES } from './registrationDraftProgress.js';

export class RegistrationQueryValidationError extends Error {
  constructor(public details: Record<string, string>) {
    super('Registration query is invalid');
  }
}

export const REGISTRATION_QUERY_OPERATORS = [
  'eq',
  'neq',
  'in',
  'not_in',
  'contains',
  'not_contains',
  'starts_with',
  'gt',
  'gte',
  'lt',
  'lte',
  'is_empty',
  'is_not_empty',
] as const;

export type RegistrationQueryOperator = (typeof REGISTRATION_QUERY_OPERATORS)[number];
export type RegistrationQueryMatch = 'all' | 'any';
export type RegistrationQueryValueType = 'enum' | 'string' | 'number' | 'boolean' | 'date';

export type RegistrationQueryRule = {
  field: string;
  operator: RegistrationQueryOperator;
  value?: unknown;
};

export type RegistrationStaffQuery = {
  match: RegistrationQueryMatch;
  rules: RegistrationQueryRule[];
};

export type RegistrationQueryFieldOption = {
  value: string;
  label: string;
};

export type RegistrationQueryField = {
  key: string;
  label: string;
  group: string;
  valueType: RegistrationQueryValueType;
  operators: RegistrationQueryOperator[];
  options?: RegistrationQueryFieldOption[];
  allowCustomValue?: boolean;
  nullable?: boolean;
};

export const LISTABLE_REGISTRATION_STATUSES = [
  'submitted',
  'awaiting_staff_review',
  'awaiting_placement',
  'awaiting_payment',
  'payment_started',
  'paid',
  'confirmed',
  'cancelled',
] as const;

const ACTIVE_WAITLIST_ENTRY_STATUSES = ['active', 'offered'] as const;
const VALUELESS_OPERATORS = new Set<RegistrationQueryOperator>(['is_empty', 'is_not_empty']);

const OPERATOR_LABELS: Record<RegistrationQueryOperator, string> = {
  eq: 'is',
  neq: 'is not',
  in: 'is any of',
  not_in: 'is none of',
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
  gt: 'greater than',
  gte: 'at least',
  lt: 'less than',
  lte: 'at most',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
};

type DrizzleHandle = ReturnType<typeof getDrizzleDb>;

function operatorsFor(valueType: RegistrationQueryValueType, nullable: boolean): RegistrationQueryOperator[] {
  if (valueType === 'enum') {
    return nullable
      ? ['eq', 'neq', 'in', 'not_in', 'is_empty', 'is_not_empty']
      : ['eq', 'neq', 'in', 'not_in'];
  }
  if (valueType === 'boolean') {
    return nullable ? ['eq', 'neq', 'is_empty', 'is_not_empty'] : ['eq', 'neq'];
  }
  if (valueType === 'number' || valueType === 'date') {
    return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty'];
  }
  return ['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'is_empty', 'is_not_empty'];
}

function defineField(
  key: string,
  label: string,
  group: string,
  valueType: RegistrationQueryValueType,
  options?: RegistrationQueryFieldOption[],
  extras?: { allowCustomValue?: boolean; nullable?: boolean },
): RegistrationQueryField {
  const nullable = extras?.nullable ?? false;
  return {
    key,
    label,
    group,
    valueType,
    operators: operatorsFor(valueType, nullable),
    options,
    allowCustomValue: extras?.allowCustomValue,
    nullable,
  };
}

const BOOLEAN_OPTIONS: RegistrationQueryFieldOption[] = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
];

const STATUS_OPTIONS: RegistrationQueryFieldOption[] = [
  { value: 'identity_incomplete', label: 'Identity incomplete' },
  { value: 'policies_incomplete', label: 'Policies incomplete' },
  { value: 'demographics_incomplete', label: 'Demographics incomplete' },
  { value: 'shell_complete', label: 'Shell complete' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'awaiting_staff_review', label: 'Awaiting staff review' },
  { value: 'awaiting_placement', label: 'Awaiting placement' },
  { value: 'awaiting_payment', label: 'Awaiting payment' },
  { value: 'payment_started', label: 'Payment started' },
  { value: 'paid', label: 'Paid' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'cancelled', label: 'Canceled' },
];

const MEMBERSHIP_OPTIONS: RegistrationQueryFieldOption[] = [
  { value: 'regular', label: 'Regular membership' },
  { value: 'regular_spare_only', label: 'Regular membership, spare-only ice' },
  { value: 'social', label: 'Social membership' },
  { value: 'junior_recreational', label: 'Junior recreational membership' },
  { value: 'none', label: 'No membership' },
];

const ICE_PRIVILEGE_OPTIONS: RegistrationQueryFieldOption[] = [
  { value: 'league_play', label: 'League play' },
  { value: 'basic_ice', label: 'Basic ice' },
  { value: 'none', label: 'None' },
];

const EXPERIENCE_OPTIONS: RegistrationQueryFieldOption[] = [
  { value: 'none_or_minimal', label: 'None or minimal' },
  { value: 'specified_years', label: 'Specified years' },
  { value: 'known_existing', label: 'Already on file' },
];

const PAYMENT_STATUS_OPTIONS: RegistrationQueryFieldOption[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'deferred', label: 'Deferred' },
  { value: 'awaiting_payment', label: 'Awaiting payment' },
  { value: 'checkout_started', label: 'Checkout started' },
  { value: 'paid', label: 'Paid' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Canceled' },
  { value: 'refunded', label: 'Refunded' },
];

const FINANCIAL_ASSISTANCE_OPTIONS: RegistrationQueryFieldOption[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'partially_approved', label: 'Partially approved' },
  { value: 'denied', label: 'Denied' },
  { value: 'withdrawn', label: 'Withdrawn' },
];

const RETURNING_MEMBER_OPTIONS: RegistrationQueryFieldOption[] = [
  { value: 'returning', label: 'Returning member' },
  { value: 'new', label: 'New member' },
];

const POLICY_OPTIONS: RegistrationQueryFieldOption[] = [
  { value: 'code_of_conduct', label: 'Code of conduct' },
  { value: 'maapp', label: 'MAAPP' },
  { value: 'privacy', label: 'Privacy' },
];

const SELECTION_TYPE_OPTIONS: RegistrationQueryFieldOption[] = [
  { value: 'sabbatical', label: 'Sabbatical' },
  { value: 'drop', label: 'Drop' },
  { value: 'junior_recreational', label: 'Junior recreational' },
  { value: 'spare_only', label: 'Spare only' },
];

function staticFields(): RegistrationQueryField[] {
  return [
    defineField('status', 'Registration status', 'Registration', 'enum', STATUS_OPTIONS),
    defineField('isDraft', 'In-progress draft', 'Registration', 'boolean', BOOLEAN_OPTIONS),
    defineField('acceptedPolicyType', 'Accepted policy', 'Registration', 'enum', POLICY_OPTIONS, { nullable: true }),
    defineField('submittedAt', 'Submitted date', 'Registration', 'date', undefined, { nullable: true }),
    defineField('cancelledAt', 'Canceled date', 'Registration', 'date', undefined, { nullable: true }),
    defineField('membershipOption', 'Membership option', 'Membership', 'enum', MEMBERSHIP_OPTIONS),
    defineField('icePrivilegesChoice', 'Ice privileges', 'Membership', 'enum', ICE_PRIVILEGE_OPTIONS),
    defineField('returningMember', 'Returning member', 'Membership', 'enum', RETURNING_MEMBER_OPTIONS, { nullable: true }),
    defineField('registeringForSelf', 'Registering for self', 'Membership', 'boolean', BOOLEAN_OPTIONS, { nullable: true }),
    defineField('lifetimeMember', 'Lifetime member', 'Membership', 'boolean', BOOLEAN_OPTIONS),
    defineField('studentDiscountClaimed', 'Student discount claimed', 'Discounts and assistance', 'boolean', BOOLEAN_OPTIONS),
    defineField('studentInstitution', 'Student institution', 'Discounts and assistance', 'string'),
    defineField('reciprocalDiscountClaimed', 'Reciprocal discount claimed', 'Discounts and assistance', 'boolean', BOOLEAN_OPTIONS),
    defineField('reciprocalClubName', 'Reciprocal club', 'Discounts and assistance', 'string'),
    defineField('usaCurlingMembershipOptIn', 'USA Curling membership opt-in', 'Discounts and assistance', 'boolean', BOOLEAN_OPTIONS, {
      nullable: true,
    }),
    defineField('uswcaMembershipOptIn', 'USWCA membership opt-in', 'Discounts and assistance', 'boolean', BOOLEAN_OPTIONS, {
      nullable: true,
    }),
    defineField(
      'financialAssistanceStatus',
      'Financial assistance status',
      'Discounts and assistance',
      'enum',
      FINANCIAL_ASSISTANCE_OPTIONS,
      { nullable: true },
    ),
    defineField('hasFinancialAssistance', 'Has financial assistance request', 'Discounts and assistance', 'boolean', BOOLEAN_OPTIONS),
    defineField('experienceType', 'Curling experience', 'Experience and ice', 'enum', EXPERIENCE_OPTIONS, { nullable: true }),
    defineField('experienceYears', 'Self-reported experience years', 'Experience and ice', 'number', undefined, { nullable: true }),
    defineField('desiredLeagueCount', 'Desired league count', 'Experience and ice', 'number', undefined, { nullable: true }),
    defineField('basicIceFallbackInterest', 'Basic ice fallback interest', 'Experience and ice', 'boolean', BOOLEAN_OPTIONS, {
      nullable: true,
    }),
    defineField('membershipCommitteeComments', 'Membership committee comments', 'Experience and ice', 'string'),
    defineField('selectionType', 'Non-league selection', 'Leagues', 'enum', SELECTION_TYPE_OPTIONS, { nullable: true }),
    defineField('requestedLeagueId', 'Requested league', 'Leagues', 'enum', [], { nullable: true }),
    defineField('placedLeagueId', 'Placed league', 'Leagues', 'enum', [], { nullable: true }),
    defineField('waitlistedLeagueId', 'Waitlisted league', 'Leagues', 'enum', [], { nullable: true }),
    defineField('offeredLeagueId', 'Pending offer league', 'Leagues', 'enum', [], { nullable: true }),
    defineField('hasWaitlist', 'On a waitlist', 'Leagues', 'boolean', BOOLEAN_OPTIONS),
    defineField('hasPendingOffer', 'Has a pending waitlist offer', 'Leagues', 'boolean', BOOLEAN_OPTIONS),
    defineField('firstName', 'First name', 'Curler', 'string'),
    defineField('lastName', 'Last name', 'Curler', 'string'),
    defineField('email', 'Email', 'Curler', 'string'),
    defineField('phone', 'Phone', 'Curler', 'string'),
    defineField('dateOfBirth', 'Date of birth', 'Curler', 'date', undefined, { nullable: true }),
    defineField('age', 'Age', 'Curler', 'number', undefined, { nullable: true }),
    defineField('mailingAddress', 'Mailing address', 'Curler', 'string'),
    defineField('emergencyContactName', 'Emergency contact name', 'Curler', 'string'),
    defineField('emergencyContactPhone', 'Emergency contact phone', 'Curler', 'string'),
    defineField(
      'preferredPronouns',
      'Preferred pronouns',
      'Curler',
      'enum',
      PREFERRED_PRONOUN_PRESET_VALUES.map((value) => ({ value, label: value })),
      { allowCustomValue: true, nullable: true },
    ),
    defineField(
      'usaCurlingCompetitionGender',
      'USA Curling competition gender',
      'Curler',
      'enum',
      USA_CURLING_COMPETITION_GENDER_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
      { nullable: true },
    ),
    defineField('demographicsCurrentConfirmed', 'Confirmed current demographics', 'Curler', 'boolean', BOOLEAN_OPTIONS),
    defineField('guardianFirstName', 'Guardian first name', 'Guardian', 'string'),
    defineField('guardianLastName', 'Guardian last name', 'Guardian', 'string'),
    defineField('guardianEmail', 'Guardian email', 'Guardian', 'string'),
    defineField('guardianPhone', 'Guardian phone', 'Guardian', 'string'),
    defineField('nameTagName', 'Name tag name', 'Name tag', 'string'),
    defineField('nameTagIncludePronouns', 'Name tag includes pronouns', 'Name tag', 'boolean', BOOLEAN_OPTIONS, { nullable: true }),
    defineField('nameTagReplacementQuantity', 'Name tag replacements', 'Name tag', 'number', undefined, { nullable: true }),
    defineField('paymentStatus', 'Invoice status', 'Payment', 'enum', PAYMENT_STATUS_OPTIONS, { nullable: true }),
    defineField('paymentDeferred', 'Payment deferred', 'Payment', 'boolean', BOOLEAN_OPTIONS),
    defineField('hasInvoice', 'Has an invoice', 'Payment', 'boolean', BOOLEAN_OPTIONS),
  ];
}

export function registrationQueryOperatorLabel(operator: RegistrationQueryOperator): string {
  return OPERATOR_LABELS[operator];
}

export function registrationQueryFieldCatalog(leagueOptions: RegistrationQueryFieldOption[] = []): RegistrationQueryField[] {
  return staticFields().map((item) => {
    if (
      item.key === 'requestedLeagueId' ||
      item.key === 'placedLeagueId' ||
      item.key === 'waitlistedLeagueId' ||
      item.key === 'offeredLeagueId'
    ) {
      return { ...item, options: leagueOptions };
    }
    return item;
  });
}

function isOperator(value: unknown): value is RegistrationQueryOperator {
  return typeof value === 'string' && (REGISTRATION_QUERY_OPERATORS as readonly string[]).includes(value);
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return null;
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => asString(item)).filter((item): item is string => item != null && item !== '');
  }
  const single = asString(value);
  return single && single !== '' ? [single] : [];
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return null;
}

function likeNeedle(value: string): string {
  return value.replace(/[%_]/g, '');
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isBlankValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function parseRegistrationStaffQuery(raw: unknown): RegistrationStaffQuery {
  if (raw == null || raw === '') {
    return { match: 'all', rules: [] };
  }
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new RegistrationQueryValidationError({ q: 'Filters must be valid JSON.' });
    }
  }
  if (typeof parsed !== 'object' || parsed == null || Array.isArray(parsed)) {
    throw new RegistrationQueryValidationError({ q: 'Filters must be an object with match and rules.' });
  }
  const body = parsed as { match?: unknown; rules?: unknown };
  const match: RegistrationQueryMatch = body.match === 'any' ? 'any' : 'all';
  const rulesInput = Array.isArray(body.rules) ? body.rules : [];
  const catalog = new Map(registrationQueryFieldCatalog().map((item) => [item.key, item]));
  const rules: RegistrationQueryRule[] = [];
  for (const [index, rule] of rulesInput.entries()) {
    if (typeof rule !== 'object' || rule == null || Array.isArray(rule)) {
      throw new RegistrationQueryValidationError({ [`rules.${index}`]: 'Each filter must be an object.' });
    }
    const candidate = rule as { field?: unknown; operator?: unknown; value?: unknown };
    const fieldKey = typeof candidate.field === 'string' ? candidate.field : '';
    const definition = catalog.get(fieldKey);
    if (!fieldKey || !definition) {
      throw new RegistrationQueryValidationError({ [`rules.${index}.field`]: 'Unknown filter field.' });
    }
    if (!isOperator(candidate.operator) || !definition.operators.includes(candidate.operator)) {
      throw new RegistrationQueryValidationError({ [`rules.${index}.operator`]: 'This operator is not valid for that field.' });
    }
    rules.push({
      field: fieldKey,
      operator: candidate.operator,
      value: candidate.value,
    });
  }
  return { match, rules };
}

export function queryRelaxesListableScope(query: RegistrationStaffQuery): boolean {
  return query.rules.some((rule) => rule.field === 'status' || rule.field === 'isDraft');
}

function emptyText(column: unknown): SQL {
  return sql`(${column} is null or trim(cast(${column} as text)) = '')`;
}

function notEmptyText(column: unknown): SQL {
  return sql`(${column} is not null and trim(cast(${column} as text)) <> '')`;
}

function textCondition(column: unknown, operator: RegistrationQueryOperator, value: unknown): SQL | null {
  if (operator === 'is_empty') return emptyText(column);
  if (operator === 'is_not_empty') return notEmptyText(column);
  const text = asString(value);
  if (text == null || text === '') return null;
  const lowered = sql`lower(coalesce(cast(${column} as text), ''))`;
  if (operator === 'eq') return sql`${lowered} = ${text.toLowerCase()}`;
  if (operator === 'neq') return sql`${lowered} <> ${text.toLowerCase()}`;
  const needle = likeNeedle(text.toLowerCase());
  if (!needle) return null;
  if (operator === 'contains') return sql`${lowered} like ${`%${needle}%`}`;
  if (operator === 'not_contains') return sql`${lowered} not like ${`%${needle}%`}`;
  if (operator === 'starts_with') return sql`${lowered} like ${`${needle}%`}`;
  return null;
}

function combinedTextCondition(columns: unknown[], operator: RegistrationQueryOperator, value: unknown): SQL | null {
  const parts = columns
    .map((column) => textCondition(column, operator, value))
    .filter((part): part is SQL => part != null);
  if (parts.length === 0) return null;
  if (operator === 'is_empty' || operator === 'not_contains' || operator === 'neq') return and(...parts)!;
  return or(...parts)!;
}

function numberCondition(column: unknown, operator: RegistrationQueryOperator, value: unknown): SQL | null {
  if (operator === 'is_empty') return sql`${column} is null`;
  if (operator === 'is_not_empty') return sql`${column} is not null`;
  const amount = asNumber(value);
  if (amount == null) return null;
  if (operator === 'eq') return sql`${column} = ${amount}`;
  if (operator === 'neq') return sql`${column} <> ${amount}`;
  if (operator === 'gt') return sql`${column} > ${amount}`;
  if (operator === 'gte') return sql`${column} >= ${amount}`;
  if (operator === 'lt') return sql`${column} < ${amount}`;
  if (operator === 'lte') return sql`${column} <= ${amount}`;
  return null;
}

function dateCondition(column: unknown, operator: RegistrationQueryOperator, value: unknown): SQL | null {
  if (operator === 'is_empty') return emptyText(column);
  if (operator === 'is_not_empty') return notEmptyText(column);
  const date = asString(value)?.slice(0, 10);
  if (!date) return null;
  const day = sql`substr(cast(${column} as text), 1, 10)`;
  if (operator === 'eq') return sql`${day} = ${date}`;
  if (operator === 'neq') return sql`${day} <> ${date}`;
  if (operator === 'gt') return sql`${day} > ${date}`;
  if (operator === 'gte') return sql`${day} >= ${date}`;
  if (operator === 'lt') return sql`${day} < ${date}`;
  if (operator === 'lte') return sql`${day} <= ${date}`;
  return null;
}

function enumCondition(column: unknown, operator: RegistrationQueryOperator, value: unknown): SQL | null {
  if (operator === 'is_empty') return emptyText(column);
  if (operator === 'is_not_empty') return notEmptyText(column);
  const values = asStringList(value);
  if (values.length === 0) return null;
  if (operator === 'eq') return sql`${column} = ${values[0]}`;
  if (operator === 'neq') return sql`${column} <> ${values[0]}`;
  if (operator === 'in') return inArray(column as never, values);
  if (operator === 'not_in') return notInArray(column as never, values);
  return null;
}

function flagCondition(
  column: unknown,
  operator: RegistrationQueryOperator,
  value: unknown,
  nullable: boolean,
): SQL | null {
  if (operator === 'is_empty') return nullable ? sql`${column} is null` : sql`${column} = 0`;
  if (operator === 'is_not_empty') return nullable ? sql`${column} is not null` : sql`${column} = 1`;
  const flag = asBoolean(value);
  if (flag == null) return null;
  if (operator === 'eq') return sql`${column} = ${flag ? 1 : 0}`;
  if (operator === 'neq') return sql`${column} <> ${flag ? 1 : 0}`;
  return null;
}

function existsAny(parts: SQL[]): SQL | null {
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0]!;
  return or(...parts)!;
}

function compileRule(handle: DrizzleHandle, rule: RegistrationQueryRule, asOfDate: string): SQL | null {
  const { db, schema } = handle;
  const registrations = schema.curlingRegistrations;
  const members = schema.members;
  const invoices = schema.registrationInvoices;
  const priorities = schema.registrationLeaguePriorities;
  const roster = schema.leagueRoster;
  const waitlistEntries = schema.waitlistEntries;
  const waitlistOffers = schema.waitlistOffers;
  const leagues = schema.leagues;
  const assistance = schema.financialAssistanceRequests;
  const policies = schema.registrationPolicyAcceptances;
  const selections = schema.registrationSelections;

  const requestedLeagueExists = (leagueId: number) =>
    exists(
      db
        .select({ id: priorities.id })
        .from(priorities)
        .where(and(eq(priorities.registration_id, registrations.id), eq(priorities.league_id, leagueId))),
    );

  const anyRequestedLeagueExists = exists(
    db.select({ id: priorities.id }).from(priorities).where(eq(priorities.registration_id, registrations.id)),
  );

  const placedLeagueExists = (leagueId: number) =>
    exists(
      db
        .select({ id: roster.id })
        .from(roster)
        .where(
          and(
            eq(roster.league_id, leagueId),
            eq(roster.status, 'active'),
            or(eq(roster.source_registration_id, registrations.id), eq(roster.member_id, registrations.curler_member_id)),
          ),
        ),
    );

  const anyPlacedLeagueExists = exists(
    db
      .select({ id: roster.id })
      .from(roster)
      .where(
        and(
          eq(roster.status, 'active'),
          or(eq(roster.source_registration_id, registrations.id), eq(roster.member_id, registrations.curler_member_id)),
        ),
      ),
  );

  const waitlistedLeagueExists = (leagueId: number) =>
    exists(
      db
        .select({ id: waitlistEntries.id })
        .from(waitlistEntries)
        .innerJoin(leagues, eq(leagues.waitlist_id, waitlistEntries.waitlist_id))
        .where(
          and(
            eq(waitlistEntries.source_registration_id, registrations.id),
            eq(leagues.id, leagueId),
            inArray(waitlistEntries.status, [...ACTIVE_WAITLIST_ENTRY_STATUSES]),
          ),
        ),
    );

  const anyWaitlistExists = exists(
    db
      .select({ id: waitlistEntries.id })
      .from(waitlistEntries)
      .where(
        and(
          eq(waitlistEntries.source_registration_id, registrations.id),
          inArray(waitlistEntries.status, [...ACTIVE_WAITLIST_ENTRY_STATUSES]),
        ),
      ),
  );

  const offeredLeagueExists = (leagueId: number) =>
    exists(
      db
        .select({ id: waitlistOffers.id })
        .from(waitlistOffers)
        .where(
          and(
            eq(waitlistOffers.source_registration_id, registrations.id),
            eq(waitlistOffers.league_id, leagueId),
            eq(waitlistOffers.status, 'pending'),
          ),
        ),
    );

  const anyPendingOfferExists = exists(
    db
      .select({ id: waitlistOffers.id })
      .from(waitlistOffers)
      .where(and(eq(waitlistOffers.source_registration_id, registrations.id), eq(waitlistOffers.status, 'pending'))),
  );

  const latestInvoiceMatches = (extra: SQL) =>
    exists(
      db
        .select({ id: invoices.id })
        .from(invoices)
        .where(
          and(
            eq(invoices.registration_id, registrations.id),
            extra,
            eq(
              invoices.id,
              sql`(
                select i.id from registration_invoices i
                where i.registration_id = ${registrations.id}
                order by i.updated_at desc, i.id desc
                limit 1
              )`,
            ),
          ),
        ),
    );

  const anyInvoiceExists = exists(
    db.select({ id: invoices.id }).from(invoices).where(eq(invoices.registration_id, registrations.id)),
  );

  const assistanceMatches = (extra?: SQL) =>
    exists(
      db
        .select({ id: assistance.id })
        .from(assistance)
        .where(
          extra ? and(eq(assistance.registration_id, registrations.id), extra) : eq(assistance.registration_id, registrations.id),
        ),
    );

  const anyPolicyExists = exists(
    db.select({ id: policies.id }).from(policies).where(eq(policies.registration_id, registrations.id)),
  );

  const policyMatches = (extra?: SQL) =>
    exists(
      db
        .select({ id: policies.id })
        .from(policies)
        .where(extra ? and(eq(policies.registration_id, registrations.id), extra) : eq(policies.registration_id, registrations.id)),
    );

  const anySelectionExists = exists(
    db.select({ id: selections.id }).from(selections).where(eq(selections.registration_id, registrations.id)),
  );

  const selectionMatches = (extra?: SQL) =>
    exists(
      db
        .select({ id: selections.id })
        .from(selections)
        .where(
          extra ? and(eq(selections.registration_id, registrations.id), extra) : eq(selections.registration_id, registrations.id),
        ),
    );

  const leagueIds = asStringList(rule.value)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);

  const leagueExistsCondition = (
    operator: RegistrationQueryOperator,
    existsOne: (leagueId: number) => SQL,
    existsAnyLeague: SQL,
  ): SQL | null => {
    if (operator === 'is_empty') return not(existsAnyLeague);
    if (operator === 'is_not_empty') return existsAnyLeague;
    if (leagueIds.length === 0) return null;
    const matches = existsAny(leagueIds.map((leagueId) => existsOne(leagueId)));
    if (!matches) return null;
    if (operator === 'eq' || operator === 'in') return matches;
    if (operator === 'neq' || operator === 'not_in') return not(matches);
    return null;
  };

  switch (rule.field) {
    case 'status':
      return enumCondition(registrations.status, rule.operator, rule.value);
    case 'isDraft': {
      const flag = asBoolean(rule.value);
      const isDraft = inArray(registrations.status, [...DRAFT_REGISTRATION_STATUSES]);
      if (rule.operator === 'eq') {
        if (flag == null) return null;
        return flag ? isDraft : not(isDraft);
      }
      if (rule.operator === 'neq') {
        if (flag == null) return null;
        return flag ? not(isDraft) : isDraft;
      }
      return null;
    }
    case 'acceptedPolicyType': {
      if (rule.operator === 'is_empty') return not(anyPolicyExists);
      if (rule.operator === 'is_not_empty') return anyPolicyExists;
      const values = asStringList(rule.value);
      if (values.length === 0) return null;
      const matches = policyMatches(inArray(policies.policy_type as never, values));
      if (rule.operator === 'eq' || rule.operator === 'in') return matches;
      if (rule.operator === 'neq' || rule.operator === 'not_in') return not(matches);
      return null;
    }
    case 'submittedAt':
      return dateCondition(registrations.submitted_at, rule.operator, rule.value);
    case 'cancelledAt':
      return dateCondition(registrations.cancelled_at, rule.operator, rule.value);
    case 'membershipOption':
      return enumCondition(registrations.membership_option, rule.operator, rule.value);
    case 'icePrivilegesChoice':
      return enumCondition(registrations.ice_privileges_choice, rule.operator, rule.value);
    case 'returningMember': {
      if (rule.operator === 'is_empty') return isNull(registrations.returning_member_answer);
      if (rule.operator === 'is_not_empty') return isNotNull(registrations.returning_member_answer);
      const mapped = asStringList(rule.value)
        .map((item) => (item === 'returning' ? 1 : item === 'new' ? 0 : null))
        .filter((item): item is 0 | 1 => item != null);
      if (mapped.length === 0) return null;
      if (rule.operator === 'eq') return eq(registrations.returning_member_answer, mapped[0]!);
      if (rule.operator === 'neq') return ne(registrations.returning_member_answer, mapped[0]!);
      if (rule.operator === 'in') return inArray(registrations.returning_member_answer, mapped);
      if (rule.operator === 'not_in') return notInArray(registrations.returning_member_answer, mapped);
      return null;
    }
    case 'registeringForSelf':
      return flagCondition(registrations.registering_for_self, rule.operator, rule.value, true);
    case 'lifetimeMember':
      return flagCondition(members.lifetime_member, rule.operator, rule.value, false);
    case 'studentDiscountClaimed':
      return flagCondition(registrations.student_discount_claimed, rule.operator, rule.value, false);
    case 'studentInstitution':
      return textCondition(registrations.student_institution, rule.operator, rule.value);
    case 'reciprocalDiscountClaimed':
      return flagCondition(registrations.reciprocal_discount_claimed, rule.operator, rule.value, false);
    case 'reciprocalClubName':
      return textCondition(registrations.reciprocal_club_name, rule.operator, rule.value);
    case 'usaCurlingMembershipOptIn':
      return flagCondition(registrations.usa_curling_membership_opt_in, rule.operator, rule.value, true);
    case 'uswcaMembershipOptIn':
      return flagCondition(registrations.uswca_membership_opt_in, rule.operator, rule.value, true);
    case 'financialAssistanceStatus': {
      if (rule.operator === 'is_empty') return not(assistanceMatches());
      if (rule.operator === 'is_not_empty') return assistanceMatches();
      const values = asStringList(rule.value);
      if (values.length === 0) return null;
      const matchStatus = assistanceMatches(inArray(assistance.status as never, values));
      if (rule.operator === 'eq' || rule.operator === 'in') return matchStatus;
      if (rule.operator === 'neq' || rule.operator === 'not_in') return not(matchStatus);
      return null;
    }
    case 'hasFinancialAssistance': {
      const flag = asBoolean(rule.value);
      if (flag == null) return null;
      const hasRequest = assistanceMatches();
      if (rule.operator === 'eq') return flag ? hasRequest : not(hasRequest);
      if (rule.operator === 'neq') return flag ? not(hasRequest) : hasRequest;
      return null;
    }
    case 'experienceType':
      return enumCondition(registrations.experience_type, rule.operator, rule.value);
    case 'experienceYears':
      return numberCondition(registrations.experience_self_reported_years, rule.operator, rule.value);
    case 'desiredLeagueCount':
      return numberCondition(registrations.desired_league_count, rule.operator, rule.value);
    case 'basicIceFallbackInterest':
      return flagCondition(registrations.basic_ice_fallback_interest, rule.operator, rule.value, true);
    case 'membershipCommitteeComments':
      return textCondition(registrations.membership_committee_comments, rule.operator, rule.value);
    case 'selectionType': {
      if (rule.operator === 'is_empty') return not(anySelectionExists);
      if (rule.operator === 'is_not_empty') return anySelectionExists;
      const values = asStringList(rule.value);
      if (values.length === 0) return null;
      const matches = selectionMatches(inArray(selections.selection_type as never, values));
      if (rule.operator === 'eq' || rule.operator === 'in') return matches;
      if (rule.operator === 'neq' || rule.operator === 'not_in') return not(matches);
      return null;
    }
    case 'requestedLeagueId':
      return leagueExistsCondition(rule.operator, requestedLeagueExists, anyRequestedLeagueExists);
    case 'placedLeagueId':
      return leagueExistsCondition(rule.operator, placedLeagueExists, anyPlacedLeagueExists);
    case 'waitlistedLeagueId':
      return leagueExistsCondition(rule.operator, waitlistedLeagueExists, anyWaitlistExists);
    case 'offeredLeagueId':
      return leagueExistsCondition(rule.operator, offeredLeagueExists, anyPendingOfferExists);
    case 'hasWaitlist': {
      const flag = asBoolean(rule.value);
      if (flag == null) return null;
      if (rule.operator === 'eq') return flag ? anyWaitlistExists : not(anyWaitlistExists);
      if (rule.operator === 'neq') return flag ? not(anyWaitlistExists) : anyWaitlistExists;
      return null;
    }
    case 'hasPendingOffer': {
      const flag = asBoolean(rule.value);
      if (flag == null) return null;
      if (rule.operator === 'eq') return flag ? anyPendingOfferExists : not(anyPendingOfferExists);
      if (rule.operator === 'neq') return flag ? not(anyPendingOfferExists) : anyPendingOfferExists;
      return null;
    }
    case 'firstName':
      return textCondition(members.first_name, rule.operator, rule.value);
    case 'lastName':
      return textCondition(members.last_name, rule.operator, rule.value);
    case 'email':
      return textCondition(members.email, rule.operator, rule.value);
    case 'phone':
      return textCondition(members.phone, rule.operator, rule.value);
    case 'dateOfBirth':
      return dateCondition(members.date_of_birth, rule.operator, rule.value);
    case 'age': {
      if (rule.operator === 'is_empty') return emptyText(members.date_of_birth);
      if (rule.operator === 'is_not_empty') return notEmptyText(members.date_of_birth);
      const age = asNumber(rule.value);
      if (age == null || age < 0) return null;
      const years = Math.floor(age);
      const cutoff = addYears(asOfDate, -years);
      const nextCutoff = addYears(asOfDate, -(years + 1));
      const dob = sql`substr(cast(${members.date_of_birth} as text), 1, 10)`;
      const knownDob = notEmptyText(members.date_of_birth);
      if (rule.operator === 'eq') return and(knownDob, sql`${dob} <= ${cutoff}`, sql`${dob} > ${nextCutoff}`)!;
      if (rule.operator === 'neq') return and(knownDob, sql`not (${dob} <= ${cutoff} and ${dob} > ${nextCutoff})`)!;
      if (rule.operator === 'gte') return and(knownDob, sql`${dob} <= ${cutoff}`)!;
      if (rule.operator === 'gt') return and(knownDob, sql`${dob} <= ${nextCutoff}`)!;
      if (rule.operator === 'lt') return and(knownDob, sql`${dob} > ${cutoff}`)!;
      if (rule.operator === 'lte') return and(knownDob, sql`${dob} > ${nextCutoff}`)!;
      return null;
    }
    case 'mailingAddress':
      return textCondition(members.mailing_address, rule.operator, rule.value);
    case 'emergencyContactName':
      return textCondition(members.emergency_contact_name, rule.operator, rule.value);
    case 'emergencyContactPhone':
      return textCondition(members.emergency_contact_phone, rule.operator, rule.value);
    case 'preferredPronouns':
      return enumCondition(members.preferred_pronouns, rule.operator, rule.value);
    case 'usaCurlingCompetitionGender':
      return enumCondition(members.usa_curling_competition_gender, rule.operator, rule.value);
    case 'demographicsCurrentConfirmed':
      return flagCondition(registrations.demographics_current_confirmed, rule.operator, rule.value, false);
    case 'guardianFirstName':
      return combinedTextCondition([registrations.guardian_first_name, members.guardian_first_name], rule.operator, rule.value);
    case 'guardianLastName':
      return combinedTextCondition([registrations.guardian_last_name, members.guardian_last_name], rule.operator, rule.value);
    case 'guardianEmail':
      return combinedTextCondition([registrations.guardian_email, members.guardian_email], rule.operator, rule.value);
    case 'guardianPhone':
      return combinedTextCondition([registrations.guardian_phone, members.guardian_phone], rule.operator, rule.value);
    case 'nameTagName':
      return textCondition(members.name_tag_name, rule.operator, rule.value);
    case 'nameTagIncludePronouns':
      return flagCondition(members.name_tag_include_pronouns, rule.operator, rule.value, true);
    case 'nameTagReplacementQuantity':
      return numberCondition(registrations.name_tag_replacement_quantity, rule.operator, rule.value);
    case 'paymentStatus': {
      if (rule.operator === 'is_empty') return not(anyInvoiceExists);
      if (rule.operator === 'is_not_empty') return anyInvoiceExists;
      const values = asStringList(rule.value);
      if (values.length === 0) return null;
      const matches = latestInvoiceMatches(inArray(invoices.status as never, values));
      if (rule.operator === 'eq' || rule.operator === 'in') return matches;
      if (rule.operator === 'neq' || rule.operator === 'not_in') return not(matches);
      return null;
    }
    case 'paymentDeferred': {
      const flag = asBoolean(rule.value);
      if (flag == null) return null;
      const deferred = latestInvoiceMatches(sql`${invoices.deferred} = 1`);
      if (rule.operator === 'eq') return flag ? deferred : not(deferred);
      if (rule.operator === 'neq') return flag ? not(deferred) : deferred;
      return null;
    }
    case 'hasInvoice': {
      const flag = asBoolean(rule.value);
      if (flag == null) return null;
      if (rule.operator === 'eq') return flag ? anyInvoiceExists : not(anyInvoiceExists);
      if (rule.operator === 'neq') return flag ? not(anyInvoiceExists) : anyInvoiceExists;
      return null;
    }
    default:
      return null;
  }
}

export function compileRegistrationStaffQuery(query: RegistrationStaffQuery, asOfDate = todayIso()): SQL[] {
  const handle = getDrizzleDb();
  const compiled: SQL[] = [];
  for (const rule of query.rules) {
    if (!VALUELESS_OPERATORS.has(rule.operator) && isBlankValue(rule.value)) continue;
    const condition = compileRule(handle, rule, asOfDate);
    if (condition) compiled.push(condition);
  }
  if (compiled.length === 0) return [];
  if (query.match === 'any') return [or(...compiled)!];
  return compiled;
}

export async function loadRegistrationStaffFilterFields(sessionId: number): Promise<{
  matchOperators: Array<{ value: RegistrationQueryMatch; label: string }>;
  operators: Array<{ value: RegistrationQueryOperator; label: string }>;
  fields: RegistrationQueryField[];
}> {
  const { db, schema } = getDrizzleDb();
  const leagues = await db
    .select({
      id: schema.leagues.id,
      name: schema.leagues.name,
    })
    .from(schema.leagues)
    .where(eq(schema.leagues.session_id, sessionId))
    .orderBy(schema.leagues.day_of_week, schema.leagues.name);
  return {
    matchOperators: [
      { value: 'all', label: 'Match all conditions' },
      { value: 'any', label: 'Match any condition' },
    ],
    operators: REGISTRATION_QUERY_OPERATORS.map((value) => ({ value, label: OPERATOR_LABELS[value] })),
    fields: registrationQueryFieldCatalog(
      leagues.map((league) => ({
        value: String(league.id),
        label: league.name,
      })),
    ),
  };
}
