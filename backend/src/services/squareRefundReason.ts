export const SQUARE_REFUND_REASON_MAX_LENGTH = 192;

export type SquareRefundReasonLineItem = {
  name: string;
  quantity: number;
  amountMinor: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function moneyAmountMinor(value: unknown): number | null {
  if (!isRecord(value)) return null;
  return asNumber(value.amount);
}

function sanitizeItemName(name: string, maxLength?: number): string {
  const cleaned = name.replace(/;/g, ',').replace(/\s+/g, ' ').trim();
  if (maxLength == null || cleaned.length <= maxLength) return cleaned;
  if (maxLength <= 1) return '…';
  return `${cleaned.slice(0, maxLength - 1)}…`;
}

export function formatRefundMoney(amountMinor: number, currency: string): string {
  const abs = (Math.abs(amountMinor) / 100).toFixed(2);
  const sign = amountMinor < 0 ? '-' : '';
  if (currency.trim().toLowerCase() === 'usd') {
    return `${sign}$${abs}`;
  }
  return `${sign}${abs} ${currency.trim().toUpperCase() || 'USD'}`;
}

function formatQuantity(quantity: number): string {
  if (!Number.isFinite(quantity) || quantity <= 0) return '1';
  if (Number.isInteger(quantity)) return String(quantity);
  return String(quantity);
}

export function formatSquareRefundReasonItem(
  item: SquareRefundReasonLineItem,
  currency: string,
  nameMaxLength?: number
): string {
  const name = sanitizeItemName(item.name || 'Item', nameMaxLength);
  return `${name} x${formatQuantity(item.quantity)} ${formatRefundMoney(item.amountMinor, currency)}`;
}

export function findLineItemsSummingTo(
  items: SquareRefundReasonLineItem[],
  targetMinor: number
): SquareRefundReasonLineItem[] | null {
  if (!Number.isFinite(targetMinor) || items.length === 0 || items.length > 16) {
    return null;
  }

  let best: SquareRefundReasonLineItem[] | null = null;

  const search = (index: number, remaining: number, chosen: SquareRefundReasonLineItem[]): void => {
    if (remaining === 0) {
      if (!best || chosen.length < best.length) {
        best = [...chosen];
      }
      return;
    }
    if (index >= items.length) return;
    if (best && best.length === 1) return;

    search(index + 1, remaining, chosen);
    search(index + 1, remaining - items[index].amountMinor, [...chosen, items[index]]);
  };

  search(0, targetMinor, []);
  return best;
}

export function selectRefundedLineItems(input: {
  items: SquareRefundReasonLineItem[];
  refundAmountMinor: number;
  orderAmountMinor: number | null;
}): { items: SquareRefundReasonLineItem[]; partial: boolean } {
  const items = input.items.filter((item) => item.name.trim().length > 0 && item.amountMinor !== 0);
  if (items.length === 0) {
    return { items: [], partial: false };
  }

  const itemTotal = items.reduce((sum, item) => sum + item.amountMinor, 0);
  const refundAmount = input.refundAmountMinor;
  const orderAmount = input.orderAmountMinor;
  const isFullRefund =
    (orderAmount != null && refundAmount >= orderAmount) || refundAmount >= itemTotal;

  if (isFullRefund) {
    return { items, partial: false };
  }

  const exactSingles = items.filter((item) => item.amountMinor === refundAmount);
  if (exactSingles.length === 1) {
    return { items: exactSingles, partial: false };
  }

  const subset = findLineItemsSummingTo(items, refundAmount);
  if (subset && subset.length > 0) {
    return { items: subset, partial: false };
  }

  return { items, partial: true };
}

function joinItemsToMaxLength(
  items: SquareRefundReasonLineItem[],
  currency: string,
  maxLength: number,
  nameMaxLength?: number
): string {
  if (items.length === 0 || maxLength <= 0) return '';

  const formatted = items.map((item) => formatSquareRefundReasonItem(item, currency, nameMaxLength));
  const parts: string[] = [];

  for (let index = 0; index < formatted.length; index += 1) {
    const remainingCount = formatted.length - index;
    const candidate = parts.length === 0 ? formatted[index] : `${parts.join('; ')}; ${formatted[index]}`;
    const suffix = remainingCount > 1 ? `; +${remainingCount - 1} more` : '';
    if (candidate.length + suffix.length <= maxLength) {
      parts.push(formatted[index]);
      continue;
    }

    if (parts.length === 0) {
      return truncateCheckoutReason(formatted[index], maxLength);
    }
    const withMore = `${parts.join('; ')}; +${remainingCount} more`;
    if (withMore.length <= maxLength) return withMore;
    return parts.join('; ');
  }

  return parts.join('; ');
}

function truncateCheckoutReason(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  if (maxLength <= 1) return '…';
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

export function extractSquareOrderRefundLineItems(order: unknown): SquareRefundReasonLineItem[] {
  if (!isRecord(order)) return [];

  const items: SquareRefundReasonLineItem[] = [];
  const rawLineItems = Array.isArray(order.lineItems)
    ? order.lineItems
    : Array.isArray(order.line_items)
      ? order.line_items
      : [];

  for (const raw of rawLineItems) {
    if (!isRecord(raw)) continue;
    const name = asString(raw.name);
    if (!name) continue;
    const quantity = asNumber(raw.quantity) ?? 1;
    const total = moneyAmountMinor(raw.totalMoney ?? raw.total_money);
    const unit = moneyAmountMinor(raw.basePriceMoney ?? raw.base_price_money) ?? 0;
    const amountMinor = total ?? Math.round(unit * quantity);
    if (amountMinor === 0) continue;
    items.push({ name, quantity: quantity > 0 ? quantity : 1, amountMinor });
  }

  const rawDiscounts = Array.isArray(order.discounts) ? order.discounts : [];
  for (const raw of rawDiscounts) {
    if (!isRecord(raw)) continue;
    const name = asString(raw.name) ?? 'Discount';
    const discountAmount =
      moneyAmountMinor(raw.appliedMoney ?? raw.applied_money ?? raw.amountMoney ?? raw.amount_money);
    if (discountAmount == null || discountAmount === 0) continue;
    items.push({
      name,
      quantity: 1,
      amountMinor: discountAmount > 0 ? -discountAmount : discountAmount,
    });
  }

  return items;
}

export function checkoutLineItemsToRefundItems(
  lineItems: Array<{ description: string; amountMinor: number; quantity?: number }> | null | undefined
): SquareRefundReasonLineItem[] {
  if (!lineItems) return [];
  return lineItems
    .filter((item) => item.description.trim().length > 0 && item.amountMinor !== 0)
    .map((item) => {
      const quantity = item.quantity;
      return {
        name: item.description.trim(),
        quantity: typeof quantity === 'number' && Number.isInteger(quantity) && quantity >= 1 ? quantity : 1,
        amountMinor: item.amountMinor,
      };
    });
}

export function buildSquareRefundReason(input: {
  items: SquareRefundReasonLineItem[];
  refundAmountMinor: number;
  orderAmountMinor?: number | null;
  currency: string;
  staffReason?: string | null;
}): string | null {
  const selected = selectRefundedLineItems({
    items: input.items,
    refundAmountMinor: input.refundAmountMinor,
    orderAmountMinor: input.orderAmountMinor ?? null,
  });
  const currency = input.currency;
  const staffReason = input.staffReason?.trim() || null;

  if (selected.items.length === 0) {
    return staffReason ? truncateCheckoutReason(staffReason, SQUARE_REFUND_REASON_MAX_LENGTH) : null;
  }

  const prefix = selected.partial ? `${formatRefundMoney(input.refundAmountMinor, currency)} of: ` : '';
  const itemBudget = SQUARE_REFUND_REASON_MAX_LENGTH - prefix.length;
  let body = joinItemsToMaxLength(selected.items, currency, itemBudget);
  if (!body) {
    body = joinItemsToMaxLength(selected.items, currency, itemBudget, 24);
  }
  let reason = `${prefix}${body}`.trim();

  if (staffReason) {
    const combined = `${reason} — ${staffReason}`;
    if (combined.length <= SQUARE_REFUND_REASON_MAX_LENGTH) {
      reason = combined;
    }
  }

  return reason.length > 0 ? truncateCheckoutReason(reason, SQUARE_REFUND_REASON_MAX_LENGTH) : null;
}
