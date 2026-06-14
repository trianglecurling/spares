import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../../api/client';
import { getApiErrorMessage } from '../../utils/api';
import InlineStateMessage from '../InlineStateMessage';
import DataTable from '../table/DataTable';
import type { DataTableColumn } from '../table/tableTypes';
import type { MemberPaymentHistoryItem, MemberPaymentHistoryResponse } from '../../../../backend/src/api/types';
import {
  formatMemberPaymentDate,
  formatMemberPaymentMoney,
  memberPaymentStatusLabel,
  memberPaymentTypeLabel,
} from '../../utils/memberPaymentDisplay';

const PAYMENT_TYPE_LINK_CLASS =
  'font-medium text-primary-teal hover:text-primary-teal/80 hover:underline dark:text-primary-teal dark:hover:text-primary-teal/80';

type ProfilePaymentHistoryTabProps = {
  memberId?: number;
};

export default function ProfilePaymentHistoryTab({ memberId }: ProfilePaymentHistoryTabProps = {}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<MemberPaymentHistoryResponse | null>(null);

  const paymentColumns: Array<DataTableColumn<MemberPaymentHistoryItem>> = useMemo(
    () => [
      {
        id: 'date',
        header: 'Date',
        renderCell: (payment) => formatMemberPaymentDate(payment.paidAt ?? payment.createdAt),
      },
      {
        id: 'type',
        header: 'Type',
        renderCell: (payment) => (
          <Link
            to={`/payments/${payment.orderToken}`}
            className={PAYMENT_TYPE_LINK_CLASS}
          >
            {memberPaymentTypeLabel(payment.subjectType)}
          </Link>
        ),
      },
      {
        id: 'description',
        header: 'Description',
        renderCell: (payment) => payment.description,
      },
      {
        id: 'amount',
        header: 'Amount',
        renderCell: (payment) => formatMemberPaymentMoney(payment.amountMinor, payment.currency),
      },
      {
        id: 'status',
        header: 'Status',
        renderCell: (payment) => memberPaymentStatusLabel(payment.status),
      },
    ],
    []
  );

  useEffect(() => {
    let cancelled = false;

    const loadHistory = async () => {
      setLoading(true);
      setError(null);
      try {
        const response =
          memberId != null
            ? await get(
                '/members/{id}/payment-history',
                { limit: 50, offset: 0 },
                { id: String(memberId) },
              )
            : await get('/members/me/payment-history', { limit: 50, offset: 0 });
        if (!cancelled) {
          setHistory(response);
        }
      } catch (loadError) {
        if (!cancelled) {
          setHistory(null);
          setError(
            getApiErrorMessage(
              loadError,
              memberId != null
                ? 'Could not load payment history for this member.'
                : 'Could not load your payment history.',
            ),
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [memberId]);

  const emptyState = useMemo(
    () => (
      <InlineStateMessage
        title="No payments yet"
        description={
          memberId != null
            ? 'Payments linked to this member account will appear here.'
            : 'Payments you make while signed in to your account will appear here.'
        }
      />
    ),
    [memberId],
  );

  if (loading) {
    return <InlineStateMessage title="Loading payment history…" />;
  }

  if (error) {
    return <InlineStateMessage title="Unable to load payment history" description={error} />;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {memberId != null
          ? 'Payments linked to this member account, including donations, event registrations, and league registrations.'
          : 'Payments made while signed in to your account, including donations, event registrations, and league registrations.'}
      </p>
      <DataTable
        rows={history?.payments ?? []}
        rowKey={(payment) => payment.orderToken}
        columns={paymentColumns}
        emptyState={emptyState}
      />
    </div>
  );
}
