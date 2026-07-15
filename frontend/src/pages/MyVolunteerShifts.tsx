import { useCallback, useEffect, useId, useState } from 'react';
import { HiChevronDown } from 'react-icons/hi2';
import { Navigate } from 'react-router-dom';
import AppStateCard from '../components/AppStateCard';
import Button from '../components/Button';
import FormField from '../components/FormField';
import Modal from '../components/Modal';
import { get, del } from '../api/client';
import api, { formatApiError } from '../utils/api';
import { useAlert } from '../contexts/AlertContext';
import { useConfirm } from '../contexts/ConfirmContext';
import {
  formatVolunteerDuration,
  formatVolunteerRange,
  type MyVolunteerSignup,
} from '../utils/volunteering';

/** Standalone route kept for old links; redirects into the hub tab. */
export default function MyVolunteerShifts() {
  return <Navigate to="/volunteering?tab=shifts" replace />;
}

export function MyVolunteerShiftsPanel() {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [upcoming, setUpcoming] = useState<MyVolunteerSignup[]>([]);
  const [past, setPast] = useState<MyVolunteerSignup[]>([]);
  const [pastExpanded, setPastExpanded] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [editingSignup, setEditingSignup] = useState<MyVolunteerSignup | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = (await get('/volunteering/my-signups')) as {
        upcoming: MyVolunteerSignup[];
        past: MyVolunteerSignup[];
      };
      setUpcoming(data.upcoming || []);
      setPast(data.past || []);
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to load your volunteer shifts'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCancel = async (signup: MyVolunteerSignup) => {
    const ok = await confirm({
      title: 'Cancel signup',
      message: `Cancel your signup for ${signup.roleName} on ${formatVolunteerRange(signup.startDt, signup.endDt)}?`,
      variant: 'danger',
    });
    if (!ok) return;
    setBusyId(signup.shiftRoleId);
    try {
      await del('/volunteering/shift-roles/{id}/signups/me', undefined, {
        id: String(signup.shiftRoleId),
      });
      showAlert('Signup cancelled.', 'success');
      await load();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to cancel signup'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return <AppStateCard title="Loading your shifts" description="Fetching your volunteer signups." />;
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="app-section-title">Upcoming</h2>
        {upcoming.length === 0 ? (
          <AppStateCard
            title="No upcoming shifts"
            description="You are not signed up for any upcoming volunteer shifts."
          />
        ) : (
          <div className="space-y-3">
            {upcoming.map((signup) => (
              <SignupCard
                key={signup.signupId}
                signup={signup}
                busy={busyId === signup.shiftRoleId}
                onCancel={() => handleCancel(signup)}
                onEditComment={() => setEditingSignup(signup)}
              />
            ))}
          </div>
        )}
      </section>

      {past.length > 0 ? (
        <section className="app-card overflow-hidden p-0">
          <h2>
            <button
              type="button"
              onClick={() => setPastExpanded((v) => !v)}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
              aria-expanded={pastExpanded}
            >
              <span className="app-section-title">Past shifts</span>
              <HiChevronDown
                className={`h-5 w-5 text-gray-500 transition-transform ${pastExpanded ? 'rotate-180' : ''}`}
              />
            </button>
          </h2>
          {pastExpanded ? (
            <div className="space-y-3 border-t border-gray-200 dark:border-gray-700 p-5">
              {past.map((signup) => (
                <SignupCard key={signup.signupId} signup={signup} />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {editingSignup ? (
        <EditCommentDialog
          signup={editingSignup}
          onClose={() => setEditingSignup(null)}
          onSaved={async () => {
            setEditingSignup(null);
            showAlert('Comment saved.', 'success');
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function SignupCard({
  signup,
  busy,
  onCancel,
  onEditComment,
}: {
  signup: MyVolunteerSignup;
  busy?: boolean;
  onCancel?: () => void;
  onEditComment?: () => void;
}) {
  const duration = formatVolunteerDuration(signup.startDt, signup.endDt);
  return (
    <div className="app-card p-4 flex flex-wrap items-start gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="font-medium text-gray-900 dark:text-gray-100">
          {signup.programTitle} · {signup.roleName}
        </div>
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {formatVolunteerRange(signup.startDt, signup.endDt)}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600 dark:text-gray-400">
          {signup.location ? <span>{signup.location}</span> : null}
          {duration ? <span>{duration}</span> : null}
        </div>
        {signup.comments ? (
          <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
            Comment: {signup.comments}
          </p>
        ) : null}
      </div>
      {signup.canCancel && (onCancel || onEditComment) ? (
        <div className="flex flex-wrap gap-2 shrink-0">
          {onEditComment ? (
            <Button type="button" variant="secondary" disabled={busy} onClick={onEditComment}>
              Edit comment
            </Button>
          ) : null}
          {onCancel ? (
            <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
              {busy ? 'Cancelling…' : 'Cancel'}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function EditCommentDialog({
  signup,
  onClose,
  onSaved,
}: {
  signup: MyVolunteerSignup;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const commentsInputId = useId();
  const [comments, setComments] = useState(signup.comments ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api.patch(`/volunteering/shift-roles/${signup.shiftRoleId}/signups/me`, {
        comments: comments.trim() || null,
      });
      await onSaved();
    } catch (err) {
      setError(formatApiError(err, 'Failed to save comment'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Edit comment" size="md" verticalAlign="start">
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {signup.programTitle} · {signup.roleName}
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {formatVolunteerRange(signup.startDt, signup.endDt)}
        </p>
        <FormField
          label="Comments"
          htmlFor={commentsInputId}
          optional
          helperText="Visible to the owners of this volunteer program."
          error={error ?? undefined}
        >
          <textarea
            id={commentsInputId}
            className="app-input w-full min-h-[96px]"
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            maxLength={2000}
            placeholder="Anything the program owners should know"
          />
        </FormField>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={submitting}>
            {submitting ? 'Saving…' : 'Save comment'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
