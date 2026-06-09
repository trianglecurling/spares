import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Layout from '../../components/Layout';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppStateCard from '../../components/AppStateCard';
import BackButton from '../../components/BackButton';
import Button from '../../components/Button';
import RegistrationViewEditModals, {
  type RegistrationEditModalKind,
} from '../../components/registration/RegistrationViewEditModals';
import {
  formatCurrency,
  isConfirmedLeaguePlacement,
  rosterTextDisplay,
  type SubmitRegistrationEditsResult,
} from '../../components/registration/registrationViewEditShared';
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
    reciprocalDiscountClaimed: boolean;
  };
  submittedBy: { id: number; name: string; email: string | null } | null;
  selections: Array<{
    id: number;
    selectionType: string;
    status: string;
    leagueName: string | null;
    replacesLeagueId: number | null;
    replacedLeagueName: string | null;
    byotTeammateText: string | null;
    isTemporarySabbaticalFill: number;
  }>;
  waitlists: Array<{
    id: number;
    waitlistName: string;
    leagueName: string;
    entryType: string;
    position: number | null;
    declineCount: number;
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
};

function label(value: string | null | undefined) {
  return value ? value.replace(/_/g, ' ') : 'Not available';
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
): { paymentsMinor: number; balanceMinor: number } {
  const grossPaymentsMinor = paymentActivity
    .filter((entry) => entry.kind === 'payment' && SETTLED_PAYMENT_STATUSES.has(entry.status))
    .reduce((sum, entry) => sum + entry.amountMinor, 0);
  const refundsMinor = paymentActivity
    .filter((entry) => entry.kind === 'refund' && entry.status === 'succeeded')
    .reduce((sum, entry) => sum + entry.amountMinor, 0);
  const netPaymentsMinor = grossPaymentsMinor - refundsMinor;
  return {
    paymentsMinor: netPaymentsMinor,
    balanceMinor: invoiceTotalMinor - netPaymentsMinor,
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

function balanceSummary(balanceMinor: number): { tone: InvoiceSummaryTone; hint: string } {
  if (balanceMinor === 0) {
    return { tone: 'balance-paid', hint: 'Paid in full' };
  }
  if (balanceMinor > 0) {
    return { tone: 'balance-due', hint: 'Amount still owed' };
  }
  return { tone: 'balance-credit', hint: 'Overpaid or credit on file' };
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
  const { registrationId } = useParams();
  const numericId = Number(registrationId);
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const { showAlert } = useAlert();
  const [detail, setDetail] = useState<RegistrationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
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
  const canEditPriorLeagueChoices =
    detail?.selections.some((selection) =>
      ['guaranteed_return', 'sabbatical', 'drop'].includes(selection.selectionType),
    ) ?? false;
  const confirmed = detail?.selections.filter(isConfirmedLeaguePlacement) ?? [];
  const playIns = detail?.selections.filter((selection) => selection.selectionType === 'play_in_request') ?? [];
  const thirdLeague =
    detail?.selections.filter((selection) =>
      ['third_league_interest', 'return_subject_to_availability'].includes(selection.selectionType),
    ) ?? [];
  const byot = detail?.selections.filter((selection) => selection.selectionType === 'byot_request') ?? [];
  const invoiceTotals =
    detail?.invoice != null
      ? invoicePaymentTotals(detail.paymentActivity, detail.invoice.totalMinor)
      : null;
  const invoiceBalanceSummary =
    invoiceTotals != null ? balanceSummary(invoiceTotals.balanceMinor) : null;
  const sabbaticals = detail?.selections.filter((selection) => selection.selectionType === 'sabbatical') ?? [];

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

  async function cancelRegistration() {
    const ok = await confirm({
      title: 'Cancel registration?',
      message:
        'This will cancel the registration, remove related waitlist entries, and issue a refund when a completed payment is on file.',
      confirmText: 'Cancel registration',
      cancelText: 'Keep registration',
      variant: 'danger',
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const response = await api.post<{ refundIssued: boolean }>(`/registration/staff/registrations/${numericId}/cancel`, {});
      showAlert(
        response.data.refundIssued
          ? 'Registration cancelled and refund issued.'
          : 'Registration cancelled.',
        'success',
        'Registration cancelled',
      );
      navigate('/admin/registrations', { replace: true });
    } catch (err) {
      showAlert(getApiErrorMessage(err, 'Unable to cancel registration.'), 'error', 'Cancel failed');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Layout>
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
              <Button type="button" variant="outline-danger" disabled={deleting} onClick={() => void cancelRegistration()}>
                Cancel registration
              </Button>
            ) : undefined
          }
        />

        <div className="mb-4">
          <BackButton to="/admin/registrations" label="Back to registrations" />
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
              {detail.payment.paymentLink ? (
                <p className="text-sm">
                  <a href={detail.payment.paymentLink} className="text-primary-teal hover:underline">
                    Open payment link
                  </a>
                </p>
              ) : null}
            </Section>

            <Section title="Payments and refunds">
              {detail.paymentActivity.length === 0 ? (
                <p>No payments or refunds have been recorded for this registration yet.</p>
              ) : (
                <div className="space-y-3">
                  {detail.paymentActivity.map((entry) => {
                    const stripeUrl =
                      entry.provider === 'stripe' ? stripeDashboardUrl(entry.providerReference) : null;
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
                                    className="text-primary-teal hover:underline"
                                  >
                                    {entry.providerReference}
                                  </a>
                                ) : (
                                  entry.providerReference
                                )}
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
                    hint="Net of successful charges and refunds"
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
              title="Confirmed leagues"
              onEdit={canEdit && canEditPriorLeagueChoices ? () => setActiveEditModal('confirmedLeagues') : undefined}
            >
              {confirmed.length === 0 ? <p>No confirmed league placements are listed yet.</p> : null}
              {confirmed.map((selection) => (
                <div key={selection.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                  <p className="font-medium">{selection.leagueName ?? label(selection.selectionType)}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-300">Status: {label(selection.status)}</p>
                </div>
              ))}
            </Section>

            <Section title="League play-ins">
              {playIns.length === 0 ? <p>No league play-ins are listed.</p> : null}
              {playIns.map((selection) => (
                <div key={selection.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                  <p className="font-medium">{selection.leagueName ?? label(selection.selectionType)}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    {selection.replacesLeagueId
                      ? `REPLACE${
                          selection.replacedLeagueName ? ` · Would replace ${selection.replacedLeagueName}` : ''
                        }`
                      : 'ADD'}
                    {' · '}
                    Placement depends on play-in results
                  </p>
                  {selection.byotTeammateText ? (
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      Pending teammates (not yet registered): {rosterTextDisplay(selection.byotTeammateText)}
                    </p>
                  ) : null}
                </div>
              ))}
            </Section>

            <Section
              title="Sabbaticals"
              onEdit={canEdit && sabbaticals.length > 0 ? () => setActiveEditModal('sabbaticals') : undefined}
            >
              {sabbaticals.length === 0 ? <p>No sabbaticals are listed for this registration.</p> : null}
              {sabbaticals.map((selection) => (
                <div key={selection.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                  <p className="font-medium">{selection.leagueName}</p>
                </div>
              ))}
            </Section>

            <Section title="Waitlists" onEdit={canEdit ? () => setActiveEditModal('waitlists') : undefined}>
              {detail.waitlists.length === 0 ? <p>No active waitlist entries are listed.</p> : null}
              {detail.waitlists.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                  <p className="font-medium">{entry.waitlistName || entry.leagueName}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    {entry.entryType.toUpperCase()} · Position {entry.position ?? 'not available'} · Declines {entry.declineCount}
                  </p>
                </div>
              ))}
            </Section>

            <Section title="Third-league interest" onEdit={canEdit ? () => setActiveEditModal('thirdLeague') : undefined}>
              {thirdLeague.length === 0 ? <p>No third-league interest choices are listed.</p> : null}
              {thirdLeague.map((selection) => (
                <p key={selection.id}>{selection.leagueName}</p>
              ))}
            </Section>

            <Section title="BYOT requests" onEdit={canEdit ? () => setActiveEditModal('byot') : undefined}>
              {byot.length === 0 ? <p>No BYOT requests are listed.</p> : null}
              {byot.map((selection) => (
                <div key={selection.id}>
                  <p className="font-medium">{selection.leagueName}</p>
                  <p>Teammates: {selection.byotTeammateText || 'Not provided'}</p>
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
              <Link to="/admin/registration/communications" className="text-sm text-primary-teal hover:underline">
                Open registration communications
              </Link>
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
    </Layout>
  );
}
