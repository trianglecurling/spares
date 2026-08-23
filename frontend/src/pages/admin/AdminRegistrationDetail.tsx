import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppStateCard from '../../components/AppStateCard';
import BackButton from '../../components/BackButton';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import RecordOfflinePaymentModal from '../../components/registration/RecordOfflinePaymentModal';
import RegistrationViewEditModals, {
  type RegistrationEditModalKind,
} from '../../components/registration/RegistrationViewEditModals';
import {
  formatCurrency,
  type RegistrationPlayInEntrySummary,
  type SubmitRegistrationEditsResult,
} from '../../components/registration/registrationViewEditShared';
import {
  guaranteeChipClassName,
  guaranteeChipLabel,
  shouldShowGuaranteeChip,
  type LeaguePriorityGuaranteeLabel,
} from '../../components/registration/leaguePriorityShared';
import RegistrationCollectedDetails from '../../components/registration/RegistrationCollectedDetails';
import type { RegistrationCollectedDetailsFields } from '../../components/registration/registrationCollectedDetailsShared';
import { playInEntryTeamMembersText } from '../../components/registration/RegistrationPlayInEntryPanel';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import api, { getApiErrorMessage } from '../../utils/api';

type InvoiceLineItem = {
  id: number;
  lineType: string;
  description: string;
  relatedLeagueId: number | null;
  amountMinor: number;
};

type RegistrationDetail = {
  registration: {
    id: number;
    curlerId: number | null;
    curlerName: string;
    seasonName: string | null;
    sessionName: string | null;
    registrationStatus: string;
    membershipOption: string;
    submittedAt: string | null;
    updatedAt: string | null;
    studentDiscountClaimed: boolean;
    studentInstitution: string | null;
    reciprocalDiscountClaimed: boolean;
    reciprocalClubName: string | null;
    usaCurlingMembershipOptIn: boolean | null;
    uswcaMembershipOptIn: boolean | null;
    nameTagName: string | null;
    nameTagIncludePronouns: boolean | null;
    nameTagReplacementQuantity: number | null;
    icePrivilegesChoice: RegistrationCollectedDetailsFields['icePrivilegesChoice'];
    experienceType: RegistrationCollectedDetailsFields['experienceType'];
    experienceSelfReportedYears: number | null;
    basicIceFallbackInterest: boolean | null;
    financialAssistance: RegistrationCollectedDetailsFields['financialAssistance'];
    guardian: RegistrationCollectedDetailsFields['guardian'];
    membershipCommitteeComments: string | null;
  };
  submittedBy: { id: number; name: string; email: string | null } | null;
  selections: Array<{
    id: number;
    selectionType: string;
    status: string;
    leagueId?: number | null;
    leagueName: string | null;
  }>;
  priorities: Array<{
    id: number;
    leagueId: number;
    leagueName: string;
    priorityRank: number;
    guaranteeLabel: LeaguePriorityGuaranteeLabel | null;
    byotTeammateText: string | null;
    teamRosterDisplay?: string | null;
  }>;
  desiredLeagueCount: number | null;
  playInEntry?: Record<number, RegistrationPlayInEntrySummary>;
  waitlists: Array<{
    id: number;
    waitlistName: string;
    leagueId: number;
    leagueName: string;
    priorityRank: number | null;
    position: number | null;
    declineCount: number;
    teamRosterDisplay?: string | null;
  }>;
  payment: {
    status: string;
    amountDueMinor: number | null;
    amountPaidMinor: number | null;
    paymentLink: string | null;
    deferredReason: string | null;
  };
  invoice: {
    id: number;
    status: string;
    subtotalMinor: number;
    discountMinor: number;
    totalMinor: number;
    deferredReason: string | null;
    paidAt: string | null;
    offlinePaymentNote: string | null;
    offlineRecordedBy: { id: number; name: string } | null;
    lineItems: InvoiceLineItem[];
  } | null;
  communications: Array<{
    id: number;
    messageType: string;
    recipientEmail: string;
    deliveryStatus: string;
  }>;
  paymentActivity: Array<{
    id: string;
    kind: 'payment' | 'refund';
    orderId: number;
    orderToken: string | null;
    amountMinor: number;
    currency: string;
    status: string;
    occurredAt: string | null;
    provider: 'stripe' | 'paypal' | 'square';
    providerReference: string | null;
    label: string;
  }>;
  canEdit: boolean;
  canCancel: boolean;
  canRequestPayment: boolean;
  canRecordOfflinePayment: boolean;
};

function label(value: string | null | undefined) {
  if (!value) return 'Not available';
  if (value === 'cancelled') return 'Canceled';
  return value.replace(/_/g, ' ');
}

function money(minor: number | null, currency = 'usd') {
  if (minor == null) return 'Not available';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(minor / 100);
}

function formatDateTime(value: string | null) {
  if (!value) return 'Date not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

const SETTLED_PAYMENT_STATUSES = new Set(['succeeded', 'partially_refunded', 'refunded']);

function invoicePaymentTotals(
  paymentActivity: RegistrationDetail['paymentActivity'],
  invoiceTotalMinor: number,
  invoiceStatus?: string | null,
): { paymentsMinor: number; balanceMinor: number; includesOfflinePayment: boolean } {
  const grossPaymentsMinor = paymentActivity
    .filter((entry) => entry.kind === 'payment' && SETTLED_PAYMENT_STATUSES.has(entry.status))
    .reduce((sum, entry) => sum + entry.amountMinor, 0);
  const refundsMinor = paymentActivity
    .filter((entry) => entry.kind === 'refund' && entry.status === 'succeeded')
    .reduce((sum, entry) => sum + entry.amountMinor, 0);
  let netPaymentsMinor = grossPaymentsMinor - refundsMinor;
  const includesOfflinePayment = invoiceStatus === 'paid' && netPaymentsMinor < invoiceTotalMinor;
  if (includesOfflinePayment) {
    netPaymentsMinor = invoiceTotalMinor;
  }
  return {
    paymentsMinor: netPaymentsMinor,
    balanceMinor: invoiceTotalMinor - netPaymentsMinor,
    includesOfflinePayment,
  };
}

type InvoiceSummaryTone = 'default' | 'discount' | 'payment' | 'balance-paid' | 'balance-due' | 'balance-credit';

function invoiceSummaryAmountClass(tone: InvoiceSummaryTone, emphasized: boolean): string {
  const base = emphasized ? 'text-base font-semibold' : 'text-sm font-medium';
  switch (tone) {
    case 'discount':
      return `${base} text-emerald-700 dark:text-emerald-400`;
    case 'balance-paid':
      return `${base} text-emerald-700 dark:text-emerald-400`;
    case 'balance-due':
      return `${base} text-amber-800 dark:text-amber-300`;
    case 'balance-credit':
      return `${base} text-sky-700 dark:text-sky-300`;
    default:
      return `${base} text-gray-900 dark:text-gray-100`;
  }
}

function InvoiceSummaryRow({
  label,
  hint,
  amount,
  tone = 'default',
  emphasized = false,
}: {
  label: string;
  hint?: string;
  amount: string;
  tone?: InvoiceSummaryTone;
  emphasized?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <div className="min-w-0">
        <dt className={`${emphasized ? 'text-sm font-semibold' : 'text-sm'} text-gray-700 dark:text-gray-300`}>
          {label}
        </dt>
        {hint ? <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{hint}</p> : null}
      </div>
      <dd className={`m-0 shrink-0 tabular-nums ${invoiceSummaryAmountClass(tone, emphasized)}`}>{amount}</dd>
    </div>
  );
}

function balanceSummary(
  balanceMinor: number,
  options?: { invoiceStatus?: string | null; registrationStatus?: string | null },
): { tone: InvoiceSummaryTone; hint: string } {
  if (
    options?.registrationStatus === 'cancelled' ||
    options?.invoiceStatus === 'cancelled' ||
    options?.invoiceStatus === 'refunded'
  ) {
    return {
      tone: 'balance-paid',
      hint: options.invoiceStatus === 'refunded' ? 'Refunded — nothing owed' : 'Canceled — nothing owed',
    };
  }
  if (balanceMinor === 0) {
    return { tone: 'balance-paid', hint: 'Paid in full' };
  }
  if (balanceMinor > 0) {
    return { tone: 'balance-due', hint: 'Amount still owed' };
  }
  return { tone: 'balance-credit', hint: 'Overpaid or credit on file' };
}

function offlinePaymentDescription(invoice: NonNullable<RegistrationDetail['invoice']>): string {
  const parts: string[] = [];
  if (invoice.offlineRecordedBy?.name) {
    parts.push(`Recorded by ${invoice.offlineRecordedBy.name}`);
  }
  if (invoice.offlinePaymentNote?.trim()) {
    parts.push(invoice.offlinePaymentNote.trim());
  }
  if (parts.length > 0) return parts.join('. ');
  return invoice.deferredReason || 'Recorded by staff';
}

function stripeDashboardUrl(providerReference: string | null): string | null {
  if (!providerReference) return null;
  const isTestMode = providerReference.startsWith('cs_test_') || providerReference.startsWith('pi_test_');
  const base = isTestMode ? 'https://dashboard.stripe.com/test' : 'https://dashboard.stripe.com';
  if (providerReference.startsWith('pi_') || providerReference.startsWith('ch_')) {
    return `${base}/payments/${encodeURIComponent(providerReference)}`;
  }
  if (providerReference.startsWith('re_')) {
    return `${base}/refunds/${encodeURIComponent(providerReference)}`;
  }
  if (providerReference.startsWith('cs_')) {
    return `${base}/checkout/sessions/${encodeURIComponent(providerReference)}`;
  }
  return null;
}

function Section({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="app-card space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h2 className="app-section-title">{title}</h2>
        {onEdit ? (
          <Button type="button" variant="secondary" onClick={onEdit}>
            Edit
          </Button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export default function AdminRegistrationDetail() {
  const { segment } = useParams<{ segment?: string }>();
  const registrationId = segment;
  const numericId = Number(registrationId);
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const { showAlert } = useAlert();
  const [detail, setDetail] = useState<RegistrationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [requestingPayment, setRequestingPayment] = useState(false);
  const [recordingPayment, setRecordingPayment] = useState(false);
  const [offlinePaymentOpen, setOfflinePaymentOpen] = useState(false);
  const [offlinePaymentError, setOfflinePaymentError] = useState<string | null>(null);
  const [activeEditModal, setActiveEditModal] = useState<RegistrationEditModalKind>(null);

  const load = useCallback(async () => {
    if (!Number.isFinite(numericId)) return;
    setLoading(true);
    try {
      const response = await api.get<RegistrationDetail>(`/registration/staff/registrations/${numericId}`);
      setDetail(response.data);
      setError(null);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Unable to load registration.'));
    } finally {
      setLoading(false);
    }
  }, [numericId]);

  useEffect(() => {
    void load();
  }, [load]);

  const canEdit = detail?.canEdit ?? false;
  const priorities = detail?.priorities ?? [];
  const waitlistByLeagueId = new Map((detail?.waitlists ?? []).map((entry) => [entry.leagueId, entry]));
  const invoiceTotals =
    detail?.invoice != null
      ? (() => {
          const totals = invoicePaymentTotals(
            detail.paymentActivity,
            detail.invoice.totalMinor,
            detail.invoice.status,
          );
          if (
            detail.registration.registrationStatus === 'cancelled' ||
            detail.invoice.status === 'cancelled' ||
            detail.invoice.status === 'refunded'
          ) {
            return { ...totals, balanceMinor: 0 };
          }
          return totals;
        })()
      : null;
  const invoiceBalanceSummary =
    invoiceTotals != null
      ? balanceSummary(invoiceTotals.balanceMinor, {
          invoiceStatus: detail?.invoice?.status,
          registrationStatus: detail?.registration.registrationStatus,
        })
      : null;
  const sabbaticals = detail?.selections.filter((selection) => selection.selectionType === 'sabbatical') ?? [];
  const drops = detail?.selections.filter((selection) => selection.selectionType === 'drop') ?? [];

  async function handleEditSaved() {
    setActiveEditModal(null);
    showAlert('Registration updated.', 'success', 'Changes saved');
    await load();
  }

  function handleStaffPaymentAdjustment(result: SubmitRegistrationEditsResult) {
    const adjustment = result.paymentAdjustment;
    if (!adjustment) return;
    if (adjustment.kind === 'refund') {
      showAlert(
        adjustment.refundIssued
          ? `A refund of ${formatCurrency(Math.abs(adjustment.adjustmentMinor))} was issued.`
          : adjustment.refundError ?? 'Refund could not be issued automatically.',
        adjustment.refundIssued ? 'success' : 'warning',
        'Payment adjusted',
      );
      return;
    }
    if (adjustment.kind === 'balance_due') {
      showAlert(
        result.checkoutUrl
          ? `An additional payment of ${formatCurrency(adjustment.adjustmentMinor)} is due. Payment link has been emailed to the curler.`
          : `An additional payment of ${formatCurrency(adjustment.adjustmentMinor)} is now due.`,
        'warning',
        'Balance due',
      );
    }
  }

  async function recordOfflinePayment(note: string) {
    setRecordingPayment(true);
    setOfflinePaymentError(null);
    try {
      await api.post(`/registration/staff/registrations/${numericId}/record-offline-payment`, { note });
      setOfflinePaymentOpen(false);
      showAlert('Payment recorded. The invoice is marked paid.', 'success', 'Payment recorded');
      await load();
    } catch (err) {
      setOfflinePaymentError(getApiErrorMessage(err, 'Unable to record payment.'));
    } finally {
      setRecordingPayment(false);
    }
  }

  async function requestPayment() {
    const ok = await confirm({
      title: 'Request payment?',
      message:
        'This sends a payment link for the leagues this curler currently holds. Use this after placement is settled, or when they will not receive additional leagues.',
      confirmText: 'Request payment',
      cancelText: 'Not now',
    });
    if (!ok) return;
    setRequestingPayment(true);
    try {
      const response = await api.post<{
        outcome: string;
        checkoutUrl?: string;
        totalDueMinor?: number;
      }>(`/registration/staff/registrations/${numericId}/request-payment`, {});
      if (response.data.outcome === 'immediate_payment' && response.data.checkoutUrl) {
        showAlert(
          `Payment link sent for ${formatCurrency(response.data.totalDueMinor ?? 0)}.`,
          'success',
          'Payment requested',
        );
      } else {
        showAlert(
          'No payment is due for the leagues this curler currently holds.',
          'info',
          'Payment requested',
        );
      }
      await load();
    } catch (err) {
      showAlert(getApiErrorMessage(err, 'Unable to request payment.'), 'error', 'Request failed');
    } finally {
      setRequestingPayment(false);
    }
  }

  const hasCompletedPayment =
    detail?.invoice?.status === 'paid' ||
    (detail?.payment.amountPaidMinor != null && detail.payment.amountPaidMinor > 0);

  async function cancelRegistration(refund: boolean) {
    if (deleting) return;
    setDeleting(true);
    try {
      const response = await api.post<{ refundIssued: boolean }>(
        `/registration/staff/registrations/${numericId}/cancel`,
        { refund },
      );
      showAlert(
        response.data.refundIssued
          ? 'Registration canceled and refund issued.'
          : 'Registration canceled.',
        'success',
        'Registration canceled',
      );
      navigate('/admin/registrations/list', { replace: true });
    } catch (err) {
      showAlert(getApiErrorMessage(err, 'Unable to cancel registration.'), 'error', 'Cancel failed');
    } finally {
      setDeleting(false);
      setCancelModalOpen(false);
    }
  }

  return (
    <>
      <AppPage>
        <AppPageHeader
          title={detail ? `Registration #${detail.registration.id}: ${detail.registration.curlerName}` : 'Registration details'}
          description={
            detail
              ? `${detail.registration.seasonName ?? 'Season'} / ${detail.registration.sessionName ?? 'Session'}`
              : undefined
          }
          actions={
            detail?.canCancel ? (
              <Button type="button" variant="outline-danger" disabled={deleting} onClick={() => setCancelModalOpen(true)}>
                Cancel registration
              </Button>
            ) : undefined
          }
        />

        <div className="mb-4">
          <BackButton to="/admin/registrations/list" label="Back to registrations" />
        </div>

        {loading ? <AppStateCard title="Loading registration" description="Gathering registration details." /> : null}
        {error ? <AppStateCard title="Unable to load registration" description={error} /> : null}

        {detail ? (
          <div className="grid gap-4">
            <Section title="Membership and payment" onEdit={canEdit ? () => setActiveEditModal('membership') : undefined}>
              {detail.submittedBy ? (
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Submitted by {detail.submittedBy.name}
                  {detail.submittedBy.email ? ` (${detail.submittedBy.email})` : ''}.
                </p>
              ) : null}
              <div className="grid gap-3 md:grid-cols-2">
                <p>Membership/program: {label(detail.registration.membershipOption)}</p>
                <p>Registration status: {label(detail.registration.registrationStatus)}</p>
                <p>Payment status: {label(detail.payment.status)}</p>
                <p>Amount due: {money(detail.payment.amountDueMinor)}</p>
                <p>Amount paid: {money(detail.payment.amountPaidMinor)}</p>
              </div>
              <RegistrationCollectedDetails fields={detail.registration} />
              {detail.registration.membershipCommitteeComments ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-700 dark:bg-gray-900/40">
                  <p className="font-medium text-gray-900 dark:text-gray-100">Comments for the Membership Committee</p>
                  <p className="mt-1 whitespace-pre-wrap text-gray-700 dark:text-gray-300">
                    {detail.registration.membershipCommitteeComments}
                  </p>
                </div>
              ) : null}
              {detail.payment.paymentLink ? (
                <p className="text-sm">
                  <a href={detail.payment.paymentLink} className="text-primary-teal-link hover:underline">
                    Open payment link
                  </a>
                </p>
              ) : null}
              {detail.invoice?.status === 'paid' &&
              (detail.invoice.offlinePaymentNote ||
                detail.invoice.offlineRecordedBy ||
                detail.invoice.deferredReason) ? (
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  {offlinePaymentDescription(detail.invoice)}
                </p>
              ) : null}
              {detail.canRequestPayment || detail.canRecordOfflinePayment ? (
                <div className="flex flex-wrap gap-3">
                  {detail.canRequestPayment ? (
                    <Button type="button" variant="secondary" disabled={requestingPayment} onClick={() => void requestPayment()}>
                      Request payment
                    </Button>
                  ) : null}
                  {detail.canRecordOfflinePayment ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={recordingPayment}
                      onClick={() => {
                        setOfflinePaymentError(null);
                        setOfflinePaymentOpen(true);
                      }}
                    >
                      Record payment received
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </Section>

            <Section title="Payments and refunds">
              {detail.paymentActivity.length === 0 && !invoiceTotals?.includesOfflinePayment ? (
                <p>No payments or refunds have been recorded for this registration yet.</p>
              ) : detail.paymentActivity.length === 0 && invoiceTotals?.includesOfflinePayment ? (
                <div className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-gray-100">Offline payment</p>
                      <p className="text-gray-600 dark:text-gray-300">
                        {detail.invoice?.paidAt ? `${formatDateTime(detail.invoice.paidAt)} · ` : null}
                        {detail.invoice ? offlinePaymentDescription(detail.invoice) : 'Recorded by staff'}
                      </p>
                    </div>
                    <p className="whitespace-nowrap font-medium text-gray-900 dark:text-gray-100">
                      {money(detail.invoice?.totalMinor ?? 0)}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {detail.paymentActivity.map((entry) => {
                    const stripeUrl =
                      entry.provider === 'stripe' ? stripeDashboardUrl(entry.providerReference) : null;
                    const receiptUrl = entry.orderToken
                      ? `/payments/${encodeURIComponent(entry.orderToken)}`
                      : null;
                    return (
                      <div
                        key={entry.id}
                        className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700"
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="font-medium text-gray-900 dark:text-gray-100">
                              {entry.label}
                              <span className="ml-2 font-normal text-gray-500 dark:text-gray-400">
                                · Order #{entry.orderId}
                              </span>
                            </p>
                            <p className="text-gray-600 dark:text-gray-300">
                              {formatDateTime(entry.occurredAt)} · {label(entry.status)} · {entry.provider}
                            </p>
                            {entry.providerReference ? (
                              <p className="mt-1 break-all text-gray-500 dark:text-gray-400">
                                {stripeUrl ? (
                                  <a
                                    href={stripeUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-primary-teal-link hover:underline"
                                  >
                                    {entry.providerReference}
                                  </a>
                                ) : (
                                  entry.providerReference
                                )}
                              </p>
                            ) : null}
                            {receiptUrl ? (
                              <p className="mt-2">
                                <a
                                  href={receiptUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-primary-teal-link hover:underline"
                                >
                                  {entry.kind === 'refund' ? 'View refund receipt' : 'View receipt'}
                                </a>
                              </p>
                            ) : null}
                          </div>
                          <p
                            className={`whitespace-nowrap font-medium ${
                              entry.kind === 'refund' ? 'text-amber-700 dark:text-amber-300' : 'text-gray-900 dark:text-gray-100'
                            }`}
                          >
                            {entry.kind === 'refund' ? '−' : ''}
                            {money(entry.amountMinor, entry.currency)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>

            {detail.invoice ? (
              <Section title="Invoice">
                <div className="space-y-2">
                  {detail.invoice.lineItems.map((line) => (
                    <div key={line.id} className="flex items-start justify-between gap-4 text-sm">
                      <span className="text-gray-800 dark:text-gray-200">{line.description}</span>
                      <span className="whitespace-nowrap tabular-nums text-gray-900 dark:text-gray-100">
                        {money(line.amountMinor)}
                      </span>
                    </div>
                  ))}
                </div>
                <dl className="mt-4 space-y-3 rounded-lg border border-gray-200 bg-gray-50/80 p-4 dark:border-gray-700 dark:bg-gray-800/40">
                  <InvoiceSummaryRow label="Subtotal" amount={money(detail.invoice.subtotalMinor)} />
                  <InvoiceSummaryRow
                    label="Discounts"
                    amount={
                      detail.invoice.discountMinor > 0
                        ? `−${money(detail.invoice.discountMinor)}`
                        : money(0)
                    }
                    tone={detail.invoice.discountMinor > 0 ? 'discount' : 'default'}
                  />
                  <div className="border-t border-gray-200 pt-3 dark:border-gray-600">
                    <InvoiceSummaryRow label="Total" amount={money(detail.invoice.totalMinor)} emphasized />
                  </div>
                  <InvoiceSummaryRow
                    label="Payments"
                    hint={
                      invoiceTotals?.includesOfflinePayment
                        ? 'Includes staff-recorded offline payment'
                        : 'Net of successful charges and refunds'
                    }
                    amount={money(invoiceTotals?.paymentsMinor ?? 0)}
                    tone="payment"
                  />
                  <div className="border-t border-gray-200 pt-3 dark:border-gray-600">
                    <InvoiceSummaryRow
                      label="Balance"
                      hint={invoiceBalanceSummary?.hint}
                      amount={money(invoiceTotals?.balanceMinor ?? detail.invoice.totalMinor)}
                      tone={invoiceBalanceSummary?.tone ?? 'default'}
                      emphasized
                    />
                  </div>
                </dl>
              </Section>
            ) : null}

            <Section
              title="League priorities"
              onEdit={canEdit ? () => setActiveEditModal('leaguePriority') : undefined}
            >
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {detail.desiredLeagueCount
                  ? `Wants ${detail.desiredLeagueCount} ${
                      detail.desiredLeagueCount === 1 ? 'league' : 'leagues'
                    }, listed most wanted first.`
                  : 'Listed most wanted first.'}
              </p>
              {priorities.length === 0 ? <p>No leagues are on this registrant's list.</p> : null}
              {priorities.map((priority) => {
                const playInSummary = detail.playInEntry?.[priority.leagueId];
                const waitlistEntry = waitlistByLeagueId.get(priority.leagueId);
                return (
                  <div key={priority.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">
                        {priority.priorityRank}. {priority.leagueName}
                      </p>
                      {shouldShowGuaranteeChip(priority.guaranteeLabel) ? (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${guaranteeChipClassName(
                            priority.guaranteeLabel,
                          )}`}
                        >
                          {guaranteeChipLabel(priority.guaranteeLabel)}
                        </span>
                      ) : null}
                    </div>
                    {waitlistEntry ? (
                      <p className="text-sm text-gray-600 dark:text-gray-300">
                        Waitlist position {waitlistEntry.position ?? 'not available'} · Declines{' '}
                        {waitlistEntry.declineCount}
                      </p>
                    ) : null}
                    {playInSummary?.existingTeam ? (
                      <p className="text-sm text-gray-600 dark:text-gray-300">
                        Team: {playInEntryTeamMembersText(playInSummary.existingTeam)}
                      </p>
                    ) : priority.teamRosterDisplay ? (
                      <p className="text-sm text-gray-600 dark:text-gray-300">
                        Team roster: {priority.teamRosterDisplay}
                      </p>
                    ) : null}
                    {playInSummary && !playInSummary.guaranteed ? (
                      <p className="text-sm text-gray-600 dark:text-gray-300">
                        Play-in league. Entry is not yet won.
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </Section>

            <Section title="Sabbaticals and drops">
              {sabbaticals.length === 0 && drops.length === 0 ? (
                <p>No sabbaticals or drops are listed for this registration.</p>
              ) : null}
              {sabbaticals.map((selection) => (
                <div key={selection.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                  <p className="font-medium">{selection.leagueName}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-300">Sabbatical</p>
                </div>
              ))}
              {drops.map((selection) => (
                <div key={selection.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                  <p className="font-medium">{selection.leagueName}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-300">Dropped</p>
                </div>
              ))}
            </Section>

            <Section title="Waitlists">
              {detail.waitlists.length === 0 ? <p>No active waitlist entries are listed.</p> : null}
              {detail.waitlists.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                  <p className="font-medium">{entry.waitlistName || entry.leagueName}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    {entry.priorityRank ? `Priority ${entry.priorityRank} · ` : ''}
                    Position {entry.position ?? 'not available'} · Declines {entry.declineCount}
                  </p>
                  {entry.teamRosterDisplay ? (
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      Team roster: {entry.teamRosterDisplay}
                    </p>
                  ) : null}
                </div>
              ))}
            </Section>

            <Section title="Communication history">
              {detail.communications.length === 0 ? <p>No registration communications have been logged yet.</p> : null}
              <div className="space-y-2">
                {detail.communications.map((communication) => (
                  <div key={communication.id} className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-800">
                    <p className="font-medium">{label(communication.messageType)}</p>
                    <p>
                      {communication.recipientEmail} · {label(communication.deliveryStatus)}
                    </p>
                  </div>
                ))}
              </div>
            </Section>

            <RegistrationViewEditModals
              registrationId={detail.registration.id}
              activeModal={activeEditModal}
              onClose={() => setActiveEditModal(null)}
              onSaved={handleEditSaved}
              staffMode
              onStaffPaymentAdjustment={handleStaffPaymentAdjustment}
            />
          </div>
        ) : null}
      </AppPage>
      <Modal
        isOpen={cancelModalOpen && detail != null}
        onClose={() => {
          if (deleting) return;
          setCancelModalOpen(false);
        }}
        title="Cancel registration?"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            This will cancel the registration
            {detail ? ` for ${detail.registration.curlerName}` : ''} and remove related waitlist entries.
          </p>
          {hasCompletedPayment ? (
            <p className="text-sm text-gray-700 dark:text-gray-300">
              A completed payment is on file. Canceling can refund that payment, or leave it in place if it was
              applied to another registration.
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setCancelModalOpen(false)}
              disabled={deleting}
            >
              Keep registration
            </Button>
            {hasCompletedPayment ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => void cancelRegistration(false)}
                disabled={deleting}
              >
                Cancel without refunding
              </Button>
            ) : null}
            <Button
              type="button"
              variant="danger"
              onClick={() => void cancelRegistration(hasCompletedPayment)}
              disabled={deleting}
            >
              {deleting
                ? 'Canceling...'
                : hasCompletedPayment
                  ? 'Cancel and refund'
                  : 'Cancel registration'}
            </Button>
          </div>
        </div>
      </Modal>
      <RecordOfflinePaymentModal
        isOpen={offlinePaymentOpen}
        saving={recordingPayment}
        description="Marks this invoice as paid without creating a checkout link. Use this for a check, cash, or another offline payment."
        confirmText="Record payment"
        confirmBusyText="Recording payment"
        error={offlinePaymentError}
        onClose={() => {
          if (recordingPayment) return;
          setOfflinePaymentOpen(false);
          setOfflinePaymentError(null);
        }}
        onSubmit={(note) => void recordOfflinePayment(note)}
      />
    </>
  );
}
