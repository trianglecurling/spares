export type PaymentOrderStatus =
  | 'created'
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'pending_refund'
  | 'refunded'
  | 'partially_refunded';

export function formatPaymentOrderStatusLabel(status: PaymentOrderStatus | string): string {
  switch (status) {
    case 'created':
      return 'Created';
    case 'pending':
      return 'Pending';
    case 'succeeded':
      return 'Succeeded';
    case 'failed':
      return 'Failed';
    case 'pending_refund':
      return 'Pending refund';
    case 'refunded':
      return 'Refunded';
    case 'partially_refunded':
      return 'Partially refunded';
    default:
      return status.replace(/_/g, ' ');
  }
}

export function paymentOrderStatusClassName(status: PaymentOrderStatus | string): string {
  switch (status) {
    case 'succeeded':
      return 'text-green-700 dark:text-emerald-300';
    case 'pending':
    case 'pending_refund':
      return 'text-amber-700 dark:text-amber-300';
    case 'failed':
      return 'text-red-700 dark:text-red-300';
    case 'refunded':
    case 'partially_refunded':
      return 'text-gray-600 dark:text-gray-300';
    default:
      return 'text-gray-700 dark:text-gray-200';
  }
}
