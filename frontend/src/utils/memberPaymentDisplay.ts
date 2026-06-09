import type {
  MemberPaymentHistoryStatus,
  MemberPaymentHistorySubjectType,
} from '../../../backend/src/api/types';

export function formatMemberPaymentMoney(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function formatMemberPaymentDate(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export function memberPaymentTypeLabel(subjectType: MemberPaymentHistorySubjectType): string {
  switch (subjectType) {
    case 'donation':
      return 'Donation';
    case 'event_registration':
      return 'Event registration';
    case 'curling_registration':
      return 'League registration';
    case 'membership':
      return 'Membership';
    default:
      return 'Payment';
  }
}

export function memberPaymentStatusLabel(status: MemberPaymentHistoryStatus): string {
  switch (status) {
    case 'succeeded':
      return 'Paid';
    case 'pending':
      return 'Pending';
    case 'failed':
      return 'Failed';
    case 'refunded':
      return 'Refunded';
    case 'partially_refunded':
      return 'Partially refunded';
    case 'created':
      return 'Created';
    default:
      return status;
  }
}
