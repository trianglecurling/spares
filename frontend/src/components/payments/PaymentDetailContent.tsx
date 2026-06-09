import InlineStateMessage from '../InlineStateMessage';
import {
  formatMemberPaymentDate,
  formatMemberPaymentMoney,
  memberPaymentStatusLabel,
  memberPaymentTypeLabel,
} from '../../utils/memberPaymentDisplay';
import type { MemberPaymentDetail } from '../../../../backend/src/api/types';

function SummaryRow({
  label,
  value,
  emphasized = false,
  publicTheme = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
  publicTheme?: boolean;
}) {
  const labelClass = publicTheme
    ? `text-gray-600 ${emphasized ? 'font-medium text-gray-900' : ''}`
    : `text-gray-600 dark:text-gray-400 ${emphasized ? 'font-medium text-gray-900 dark:text-gray-100' : ''}`;
  const valueClass = publicTheme
    ? emphasized
      ? 'text-base font-semibold text-gray-900'
      : 'text-sm font-medium text-gray-900'
    : emphasized
      ? 'text-base font-semibold text-gray-900 dark:text-gray-100'
      : 'text-sm font-medium text-gray-900 dark:text-gray-100';

  return (
    <div className="flex items-start justify-between gap-4">
      <dt className={labelClass}>{label}</dt>
      <dd className={`text-right tabular-nums ${valueClass}`}>{value}</dd>
    </div>
  );
}

type PaymentDetailContentProps = {
  detail: MemberPaymentDetail;
  publicTheme?: boolean;
};

export default function PaymentDetailContent({ detail, publicTheme = false }: PaymentDetailContentProps) {
  const showDiscount = detail.discountMinor != null && detail.discountMinor > 0;
  const showTotals =
    detail.subtotalMinor != null &&
    detail.totalMinor != null &&
    (detail.lineItems.length > 1 || showDiscount);

  const sectionTitleClass = publicTheme ? 'text-lg font-semibold text-gray-900' : 'app-section-title';
  const cardClass = publicTheme
    ? 'public-card space-y-6 p-6 sm:p-8'
    : 'app-card space-y-6';
  const contextLabelClass = publicTheme ? 'text-gray-600' : 'text-gray-600 dark:text-gray-400';
  const contextValueClass = publicTheme ? 'text-gray-900' : 'text-gray-900 dark:text-gray-100';
  const lineTextClass = publicTheme ? 'text-gray-800' : 'text-gray-800 dark:text-gray-200';
  const lineAmountClass = publicTheme ? 'text-gray-900' : 'text-gray-900 dark:text-gray-100';
  const totalsBoxClass = publicTheme
    ? 'mt-4 space-y-3 rounded-lg border border-gray-200 bg-gray-50/80 p-4'
    : 'mt-4 space-y-3 rounded-lg border border-gray-200 bg-gray-50/80 p-4 dark:border-gray-700 dark:bg-gray-800/40';
  const refundBoxClass = publicTheme
    ? 'rounded-lg border border-gray-200 p-3 text-sm'
    : 'rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700';
  const refundTitleClass = publicTheme ? 'font-medium text-gray-900' : 'font-medium text-gray-900 dark:text-gray-100';
  const refundMetaClass = publicTheme ? 'text-gray-600' : 'text-gray-600 dark:text-gray-300';
  const refundAmountClass = publicTheme
    ? 'whitespace-nowrap font-medium text-amber-700'
    : 'whitespace-nowrap font-medium text-amber-700 dark:text-amber-300';

  return (
    <div className={cardClass}>
      <section className="space-y-3">
        <h2 className={sectionTitleClass}>Summary</h2>
        <dl className="space-y-2 text-sm">
          <SummaryRow label="Type" value={memberPaymentTypeLabel(detail.subjectType)} publicTheme={publicTheme} />
          <SummaryRow label="Status" value={memberPaymentStatusLabel(detail.status)} publicTheme={publicTheme} />
          <SummaryRow
            label="Amount"
            value={formatMemberPaymentMoney(detail.amountMinor, detail.currency)}
            emphasized
            publicTheme={publicTheme}
          />
          <SummaryRow label="Paid" value={formatMemberPaymentDate(detail.paidAt)} publicTheme={publicTheme} />
          <SummaryRow label="Created" value={formatMemberPaymentDate(detail.createdAt)} publicTheme={publicTheme} />
          <SummaryRow label="Provider" value={detail.provider} publicTheme={publicTheme} />
          {detail.providerReference ? (
            <SummaryRow label="Payment reference" value={detail.providerReference} publicTheme={publicTheme} />
          ) : null}
        </dl>
      </section>

      {detail.context.length > 0 ? (
        <section className="space-y-3">
          <h2 className={sectionTitleClass}>Details</h2>
          <dl className="space-y-2 text-sm">
            {detail.context.map((field) => (
              <div key={`${field.label}-${field.value}`} className="grid gap-1 sm:grid-cols-[10rem_1fr]">
                <dt className={contextLabelClass}>{field.label}</dt>
                <dd className={contextValueClass}>{field.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className={sectionTitleClass}>Line items</h2>
        {detail.lineItems.length === 0 ? (
          <InlineStateMessage title="No line items recorded for this payment." />
        ) : (
          <div className="space-y-2">
            {detail.lineItems.map((line, index) => (
              <div key={`${line.description}-${index}`} className="flex items-start justify-between gap-4 text-sm">
                <span className={lineTextClass}>{line.description}</span>
                <span className={`whitespace-nowrap tabular-nums ${lineAmountClass}`}>
                  {formatMemberPaymentMoney(line.amountMinor, detail.currency)}
                </span>
              </div>
            ))}
          </div>
        )}

        {showTotals ? (
          <dl className={totalsBoxClass}>
            <SummaryRow
              label="Subtotal"
              value={formatMemberPaymentMoney(detail.subtotalMinor ?? 0, detail.currency)}
              publicTheme={publicTheme}
            />
            {showDiscount ? (
              <SummaryRow
                label="Discounts"
                value={`−${formatMemberPaymentMoney(detail.discountMinor ?? 0, detail.currency)}`}
                publicTheme={publicTheme}
              />
            ) : null}
            <div className={publicTheme ? 'border-t border-gray-200 pt-3' : 'border-t border-gray-200 pt-3 dark:border-gray-600'}>
              <SummaryRow
                label="Total"
                value={formatMemberPaymentMoney(detail.totalMinor ?? detail.amountMinor, detail.currency)}
                emphasized
                publicTheme={publicTheme}
              />
            </div>
          </dl>
        ) : null}
      </section>

      {detail.refunds.length > 0 ? (
        <section className="space-y-3">
          <h2 className={sectionTitleClass}>Refunds</h2>
          <div className="space-y-3">
            {detail.refunds.map((refund, index) => (
              <div
                key={`${refund.processedAt ?? refund.createdAt}-${refund.amountMinor}-${index}`}
                className={refundBoxClass}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <p className={refundTitleClass}>{refund.reason?.trim() || 'Refund'}</p>
                    <p className={refundMetaClass}>
                      {formatMemberPaymentDate(refund.processedAt ?? refund.createdAt)} · {refund.status}
                    </p>
                  </div>
                  <p className={refundAmountClass}>
                    −{formatMemberPaymentMoney(refund.amountMinor, refund.currency)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
