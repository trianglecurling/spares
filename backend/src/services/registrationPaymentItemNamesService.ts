import { eq } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';

function truncateCheckoutText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

export type RegistrationPaymentItemLineType =
  | 'regular_membership_fee'
  | 'social_membership_fee'
  | 'junior_recreational_fee'
  | 'league_fee'
  | 'spare_only_fee'
  | 'sabbatical_fee'
  | 'replacement_name_tag_fee'
  | 'student_discount'
  | 'student_league_discount'
  | 'reciprocal_discount'
  | 'winter_only_discount'
  | 'sabbatical_fill_discount';

export type RegistrationPaymentItemNameDefinition = {
  lineType: RegistrationPaymentItemLineType;
  label: string;
  defaultItemName: string;
};

export const REGISTRATION_PAYMENT_ITEM_NAME_DEFINITIONS: RegistrationPaymentItemNameDefinition[] = [
  {
    lineType: 'regular_membership_fee',
    label: 'Regular membership',
    defaultItemName: 'Regular membership',
  },
  {
    lineType: 'social_membership_fee',
    label: 'Social membership',
    defaultItemName: 'Social membership',
  },
  {
    lineType: 'junior_recreational_fee',
    label: 'Junior recreational membership',
    defaultItemName: 'Junior recreational membership',
  },
  {
    lineType: 'league_fee',
    label: 'League',
    defaultItemName: 'League',
  },
  {
    lineType: 'spare_only_fee',
    label: 'Basic ice privileges',
    defaultItemName: 'Basic ice privileges',
  },
  {
    lineType: 'sabbatical_fee',
    label: 'Sabbatical fee',
    defaultItemName: 'Sabbatical fee',
  },
  {
    lineType: 'replacement_name_tag_fee',
    label: 'Replacement name tag',
    defaultItemName: 'Replacement name tag',
  },
  {
    lineType: 'student_discount',
    label: 'Student discount (membership)',
    defaultItemName: 'Student discount (membership)',
  },
  {
    lineType: 'student_league_discount',
    label: 'Student discount (leagues)',
    defaultItemName: 'Student discount (leagues)',
  },
  {
    lineType: 'reciprocal_discount',
    label: 'Reciprocal discount',
    defaultItemName: 'Reciprocal discount',
  },
  {
    lineType: 'winter_only_discount',
    label: 'Winter-only discount',
    defaultItemName: 'Winter-only discount',
  },
  {
    lineType: 'sabbatical_fill_discount',
    label: 'Temporary sabbatical-fill discount',
    defaultItemName: 'Temporary sabbatical-fill discount',
  },
];

const DEFINITION_BY_LINE_TYPE = new Map(
  REGISTRATION_PAYMENT_ITEM_NAME_DEFINITIONS.map((definition) => [definition.lineType, definition])
);

export class RegistrationPaymentItemNamesServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = 'RegistrationPaymentItemNamesServiceError';
  }
}

function isRegistrationPaymentItemLineType(value: string): value is RegistrationPaymentItemLineType {
  return DEFINITION_BY_LINE_TYPE.has(value as RegistrationPaymentItemLineType);
}

export async function listRegistrationPaymentItemNames() {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      lineType: schema.registrationPaymentItemNames.line_type,
      paymentItemName: schema.registrationPaymentItemNames.payment_item_name,
    })
    .from(schema.registrationPaymentItemNames);

  const configuredNames = new Map(rows.map((row) => [row.lineType, row.paymentItemName]));

  return REGISTRATION_PAYMENT_ITEM_NAME_DEFINITIONS.map((definition) => ({
    lineType: definition.lineType,
    label: definition.label,
    defaultItemName: definition.defaultItemName,
    paymentItemName: configuredNames.get(definition.lineType) ?? null,
  }));
}

export async function updateRegistrationPaymentItemName(
  lineType: string,
  paymentItemName: string | null
): Promise<void> {
  if (!isRegistrationPaymentItemLineType(lineType)) {
    throw new RegistrationPaymentItemNamesServiceError('Unknown registration item type', 404);
  }

  const trimmed = paymentItemName?.trim() ?? '';
  const normalized = trimmed.length > 0 ? trimmed.slice(0, 512) : null;
  const { db, schema } = getDrizzleDb();

  if (normalized == null) {
    await db
      .delete(schema.registrationPaymentItemNames)
      .where(eq(schema.registrationPaymentItemNames.line_type, lineType));
    return;
  }

  await db
    .insert(schema.registrationPaymentItemNames)
    .values({
      line_type: lineType,
      payment_item_name: normalized,
    })
    .onConflictDoUpdate({
      target: schema.registrationPaymentItemNames.line_type,
      set: { payment_item_name: normalized },
    });
}

export async function loadRegistrationPaymentItemNameMap(): Promise<
  Map<RegistrationPaymentItemLineType, string | null>
> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      lineType: schema.registrationPaymentItemNames.line_type,
      paymentItemName: schema.registrationPaymentItemNames.payment_item_name,
    })
    .from(schema.registrationPaymentItemNames);

  const configuredNames = new Map<RegistrationPaymentItemLineType, string | null>();
  for (const definition of REGISTRATION_PAYMENT_ITEM_NAME_DEFINITIONS) {
    configuredNames.set(definition.lineType, null);
  }
  for (const row of rows) {
    if (!isRegistrationPaymentItemLineType(row.lineType)) continue;
    configuredNames.set(row.lineType, row.paymentItemName ?? null);
  }
  return configuredNames;
}

export function resolveRegistrationCheckoutItemDescription(input: {
  lineType: string;
  invoiceDescription: string;
  configuredNames: Map<RegistrationPaymentItemLineType, string | null>;
}): string {
  if (!isRegistrationPaymentItemLineType(input.lineType)) {
    return truncateCheckoutText(input.invoiceDescription, 512);
  }

  const definition = DEFINITION_BY_LINE_TYPE.get(input.lineType);
  const customName = input.configuredNames.get(input.lineType)?.trim();
  const resolved = customName || definition?.defaultItemName || input.invoiceDescription;
  return truncateCheckoutText(resolved, 512);
}
