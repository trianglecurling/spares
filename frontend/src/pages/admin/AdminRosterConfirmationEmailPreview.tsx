import { useEffect, useId, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppStateCard from '../../components/AppStateCard';
import BackButton from '../../components/BackButton';
import { get, patch } from '../../api/client';
import type { paths } from '../../api/generated/types';
import Button from '../../components/Button';
import MemberEmail from '../../components/MemberEmail';
import ReviewFinancialAssistanceModal from '../../components/registration/ReviewFinancialAssistanceModal';
import { canReviewFinancialAssistance } from '../../components/registration/financialAssistanceReviewShared';
import { financialAssistanceLabel } from '../../components/registration/registrationCollectedDetailsShared';
import { useAlert } from '../../contexts/AlertContext';
import { getApiErrorMessage } from '../../utils/api';
import { canHoldRosterConfirmationEmail, useRosterConfirmationEmailHolds } from './rosterConfirmationEmailHolds';
import { rosterConfirmationEmailListPath } from './rosterConfirmationEmailPaths';

type RosterConfirmationPreview =
  paths['/registration/staff/roster-confirmation-emails/{memberId}']['get']['responses']['200']['content']['application/json'];

function money(minor: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minor / 100);
}

export default function AdminRosterConfirmationEmailPreview() {
  const { subsegment: memberIdParam } = useParams<{ subsegment?: string }>();
  const [searchParams] = useSearchParams();
  const { showAlert } = useAlert();
  const previewTitleId = useId();
  const sessionId = Number(searchParams.get('sessionId')) || 0;
  const memberId = memberIdParam && /^\d+$/.test(memberIdParam) ? Number(memberIdParam) : 0;
  const [preview, setPreview] = useState<RosterConfirmationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const listHref = rosterConfirmationEmailListPath(sessionId || null);
  const { heldSet, setHeld } = useRosterConfirmationEmailHolds(sessionId || null);
  const recipientHeld = memberId > 0 && heldSet.has(memberId);
  const canHold = preview ? canHoldRosterConfirmationEmail(preview.recipient) : false;
  const assistance = preview?.recipient.financialAssistance ?? null;
  const canReview = canReviewFinancialAssistance(assistance);
  const assistanceLabel = financialAssistanceLabel(assistance);

  useEffect(() => {
    let cancelled = false;
    if (!memberId || !sessionId) return;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await get(
          '/registration/staff/roster-confirmation-emails/{memberId}',
          { sessionId },
          { memberId: String(memberId) },
        );
        if (!cancelled) setPreview(data);
      } catch (caught) {
        if (!cancelled) {
          setPreview(null);
          setError(getApiErrorMessage(caught, 'Could not load this roster email.'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [memberId, sessionId]);

  async function reloadPreview() {
    if (!memberId || !sessionId) return;
    const data = await get(
      '/registration/staff/roster-confirmation-emails/{memberId}',
      { sessionId },
      { memberId: String(memberId) },
    );
    setPreview(data);
  }

  async function saveAssistanceReview(input: {
    status: 'approved' | 'partially_approved' | 'denied';
    approvedPercentage: number;
    staffNotes: string | null;
  }) {
    if (!canReviewFinancialAssistance(assistance)) return;
    setReviewSaving(true);
    setReviewError(null);
    try {
      await patch(
        '/registration/staff/financial-assistance/{id}',
        {
          status: input.status,
          approvedPercentage: input.approvedPercentage,
          staffNotes: input.staffNotes,
        },
        { id: String(assistance.requestId) },
      );
      showAlert(
        input.status === 'denied'
          ? 'Financial assistance was denied. You can send the full-price invoice from roster emails.'
          : 'Financial assistance was saved. You can send the discounted invoice from roster emails.',
        'success',
      );
      setReviewOpen(false);
      await reloadPreview();
    } catch (caught) {
      setReviewError(getApiErrorMessage(caught, 'Unable to save this financial assistance review.'));
    } finally {
      setReviewSaving(false);
    }
  }

  if (!memberIdParam || !/^\d+$/.test(memberIdParam)) {
    return <Navigate to="/admin/registrations/roster-emails" replace />;
  }

  if (!sessionId) {
    return <Navigate to="/admin/registrations/roster-emails" replace />;
  }

  return (
    <AppPage>
      <AppPageHeader
        title={preview?.subject ?? 'Roster email preview'}
        documentTitle="Roster email preview"
        actions={
          <>
            {canReview ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setReviewError(null);
                  setReviewOpen(true);
                }}
              >
                Review assistance
              </Button>
            ) : null}
            {canHold ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setHeld(memberId, !recipientHeld)}
              >
                {recipientHeld ? 'Release hold' : 'Hold email'}
              </Button>
            ) : null}
            <BackButton label="Roster emails" to={listHref} />
          </>
        }
      />

      {loading ? <AppStateCard title="Loading email preview..." /> : null}

      {!loading && (error || !preview) ? (
        <AppStateCard
          title="Unable to load this email"
          description={error ?? 'This member is not on a league roster for the selected session.'}
          action={
            <Link to={listHref} className="text-primary-teal-link hover:underline">
              Return to roster emails
            </Link>
          }
        />
      ) : null}

      {!loading && !error && preview ? (
        <div className="space-y-6">
          <dl className="app-card grid gap-4 p-6 sm:grid-cols-2">
            <div>
              <dt className="app-label">Recipient</dt>
              <dd className="text-sm text-gray-900 dark:text-gray-100">
                <MemberEmail
                  email={preview.recipient.memberEmail}
                  parentEmail={preview.recipient.parentEmail}
                  empty="No email address"
                />
                <div className="text-gray-500 dark:text-gray-400">{preview.recipient.memberName}</div>
              </dd>
            </div>
            <div>
              <dt className="app-label">Session</dt>
              <dd className="text-sm text-gray-900 dark:text-gray-100">
                {preview.seasonName} / {preview.sessionName}
              </dd>
            </div>
            <div>
              <dt className="app-label">Balance</dt>
              <dd className="text-sm text-gray-900 dark:text-gray-100">{money(preview.recipient.balanceMinor)}</dd>
            </div>
            <div>
              <dt className="app-label">Status</dt>
              <dd className="text-sm text-gray-900 dark:text-gray-100">
                {preview.recipient.skipReason === 'pending_financial_assistance'
                  ? 'Needs financial assistance review before this invoice can be sent'
                  : preview.recipient.alreadySent && preview.recipient.balanceMinor > 0
                    ? 'Already sent. A payment reminder will reuse the existing payment link.'
                    : preview.recipient.alreadySent
                    ? 'Already sent'
                    : recipientHeld
                      ? 'Held — skipped by Send all unsent'
                      : 'Preview only — not sent'}
                {preview.paymentLinkPending && preview.recipient.skipReason !== 'pending_financial_assistance'
                  ? '. Payment link will be created at send time.'
                  : ''}
              </dd>
            </div>
            {assistanceLabel ? (
              <div>
                <dt className="app-label">Financial assistance</dt>
                <dd className="text-sm text-gray-900 dark:text-gray-100">{assistanceLabel}</dd>
              </div>
            ) : null}
            <div className="sm:col-span-2">
              <dt className="app-label">Subject</dt>
              <dd className="text-sm text-gray-900 dark:text-gray-100">{preview.subject}</dd>
            </div>
          </dl>

          <section className="app-card p-6" aria-labelledby={previewTitleId}>
            <h2 id={previewTitleId} className="app-section-title mb-4">
              Email body
            </h2>
            <iframe
              title={`Email body for ${preview.subject}`}
              sandbox=""
              referrerPolicy="no-referrer"
              srcDoc={preview.htmlBody}
              className="h-[70vh] min-h-[24rem] w-full rounded-md border border-gray-200 bg-white dark:border-gray-700"
            />
          </section>
        </div>
      ) : null}

      {reviewOpen && canReviewFinancialAssistance(assistance) ? (
        <ReviewFinancialAssistanceModal
          isOpen
          saving={reviewSaving}
          memberName={preview?.recipient.memberName ?? ''}
          assistance={assistance}
          error={reviewError}
          onClose={() => {
            if (reviewSaving) return;
            setReviewOpen(false);
            setReviewError(null);
          }}
          onSubmit={(input) => {
            void saveAssistanceReview(input);
          }}
        />
      ) : null}
    </AppPage>
  );
}
