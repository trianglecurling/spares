import { eq, inArray } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { Member } from '../types.js';
import {
  defaultNameTagPrintName,
  nameTagIncludePronounsFromStored,
  normalizeNameTagName,
  parseNameTagReplacementQuantity,
  resolveNameTagIncludePronounsForSave,
} from '../utils/nameTag.js';
import { resolvePreferredPronounsForSave } from '../utils/preferredPronouns.js';
import {
  applyPriorPaidToInvoiceLines,
  type RegistrationCheckoutInvoiceLine,
} from './registrationBillingMath.js';
import { listStaffRegistrationBilling, type StaffRegistrationBillingLine } from './registrationBillingService.js';

export type NameTagOrderKind = 'new_member' | 'paid_replacement';

export type NameTagOrder = {
  registrationId: number;
  curlerId: number | null;
  curlerName: string;
  nameTagName: string;
  includePronouns: boolean;
  pronouns: string | null;
  quantity: number;
  kind: NameTagOrderKind;
};

export type NameTagRegistrationDetails = {
  returningMemberAnswer: number | null;
  nameTagReplacementQuantity: unknown;
  nameTagName: string | null;
  nameTagIncludePronouns: unknown;
  preferredPronouns: string | null;
  firstName: string | null;
  lastName: string | null;
};

const REPLACEMENT_NAME_TAG_LINE = 'replacement_name_tag_fee';
const LEAGUE_FEE_LINE = 'league_fee';

/**
 * Payments are not itemized. Cover membership and other non-league charges
 * first, then the replacement name tag, then league fees. A replacement stays
 * on the list after the name tag fee is covered even when a later league fee
 * is still unpaid. League fees are often billed after the name tag.
 */
export function replacementNameTagFeeIsPaid(input: {
  chargeLines: RegistrationCheckoutInvoiceLine[];
  discountLines: RegistrationCheckoutInvoiceLine[];
  paidMinor: number;
}): boolean {
  const nameTagMinor = input.chargeLines
    .filter((line) => line.lineType === REPLACEMENT_NAME_TAG_LINE && line.amountMinor > 0)
    .reduce((sum, line) => sum + line.amountMinor, 0);
  if (nameTagMinor <= 0) return false;

  const ordered = [
    ...input.chargeLines.filter(
      (line) => line.lineType !== REPLACEMENT_NAME_TAG_LINE && line.lineType !== LEAGUE_FEE_LINE,
    ),
    ...input.chargeLines.filter((line) => line.lineType === REPLACEMENT_NAME_TAG_LINE),
    ...input.chargeLines.filter((line) => line.lineType === LEAGUE_FEE_LINE),
    ...input.discountLines,
  ];
  const unpaid = applyPriorPaidToInvoiceLines(ordered, input.paidMinor);
  return !unpaid.some((line) => line.lineType === REPLACEMENT_NAME_TAG_LINE && line.amountMinor > 0);
}

function toCheckoutLine(line: StaffRegistrationBillingLine): RegistrationCheckoutInvoiceLine {
  return {
    description: line.description,
    amountMinor: line.amountMinor,
    lineType: line.lineType,
  };
}

function printName(details: NameTagRegistrationDetails, curlerName: string): string {
  return (
    normalizeNameTagName(details.nameTagName) ||
    defaultNameTagPrintName(details.firstName, details.lastName) ||
    curlerName.trim()
  );
}

function pronounChoice(details: NameTagRegistrationDetails): { includePronouns: boolean; pronouns: string | null } {
  const includePronouns = resolveNameTagIncludePronounsForSave(
    details.preferredPronouns,
    nameTagIncludePronounsFromStored(details.nameTagIncludePronouns),
  );
  if (!includePronouns) return { includePronouns: false, pronouns: null };
  return { includePronouns: true, pronouns: resolvePreferredPronounsForSave(details.preferredPronouns) };
}

export function selectNameTagOrders(input: {
  rows: Array<{
    registrationId: number;
    curlerId: number | null;
    curlerName: string;
    owedLines: StaffRegistrationBillingLine[];
    owedDiscountLines: StaffRegistrationBillingLine[];
    paidMinor: number;
  }>;
  detailsByRegistrationId: Map<number, NameTagRegistrationDetails>;
}): NameTagOrder[] {
  const orders: NameTagOrder[] = [];
  for (const row of input.rows) {
    const details = input.detailsByRegistrationId.get(row.registrationId);
    if (!details) continue;
    const pronouns = pronounChoice(details);
    const shared = {
      registrationId: row.registrationId,
      curlerId: row.curlerId,
      curlerName: row.curlerName,
      nameTagName: printName(details, row.curlerName),
      includePronouns: pronouns.includePronouns,
      pronouns: pronouns.pronouns,
    };
    if (details.returningMemberAnswer !== 1) {
      orders.push({ ...shared, quantity: 1, kind: 'new_member' });
      continue;
    }
    const quantity = parseNameTagReplacementQuantity(details.nameTagReplacementQuantity);
    if (quantity !== 1 && quantity !== 2 && quantity !== 3) continue;
    const paid = replacementNameTagFeeIsPaid({
      chargeLines: row.owedLines.map(toCheckoutLine),
      discountLines: row.owedDiscountLines.map(toCheckoutLine),
      paidMinor: row.paidMinor,
    });
    if (!paid) continue;
    orders.push({ ...shared, quantity, kind: 'paid_replacement' });
  }

  return orders.sort((left, right) => {
    const nameDiff = left.nameTagName.localeCompare(right.nameTagName);
    if (nameDiff !== 0) return nameDiff;
    return left.registrationId - right.registrationId;
  });
}

export async function listStaffRegistrationNameTags(input: { actor: Member; sessionId: number }): Promise<{
  sessionId: number;
  sessionName: string;
  nameTags: NameTagOrder[];
}> {
  const billing = await listStaffRegistrationBilling(input);
  const registrationIds = billing.registrations.map((row) => row.registrationId);
  const detailsByRegistrationId = new Map<number, NameTagRegistrationDetails>();
  if (registrationIds.length > 0) {
    const { db, schema } = getDrizzleDb();
    const detailRows = await db
      .select({
        registrationId: schema.curlingRegistrations.id,
        returningMemberAnswer: schema.curlingRegistrations.returning_member_answer,
        nameTagReplacementQuantity: schema.curlingRegistrations.name_tag_replacement_quantity,
        nameTagName: schema.members.name_tag_name,
        nameTagIncludePronouns: schema.members.name_tag_include_pronouns,
        preferredPronouns: schema.members.preferred_pronouns,
        firstName: schema.members.first_name,
        lastName: schema.members.last_name,
      })
      .from(schema.curlingRegistrations)
      .leftJoin(schema.members, eq(schema.curlingRegistrations.curler_member_id, schema.members.id))
      .where(inArray(schema.curlingRegistrations.id, registrationIds));
    for (const row of detailRows) {
      detailsByRegistrationId.set(row.registrationId, {
        returningMemberAnswer: row.returningMemberAnswer,
        nameTagReplacementQuantity: row.nameTagReplacementQuantity,
        nameTagName: row.nameTagName,
        nameTagIncludePronouns: row.nameTagIncludePronouns,
        preferredPronouns: row.preferredPronouns,
        firstName: row.firstName,
        lastName: row.lastName,
      });
    }
  }

  return {
    sessionId: billing.sessionId,
    sessionName: billing.sessionName,
    nameTags: selectNameTagOrders({
      rows: billing.registrations,
      detailsByRegistrationId,
    }),
  };
}
