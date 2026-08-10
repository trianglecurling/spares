import { useId, useState } from 'react';
import Button from '../Button';
import FormField from '../FormField';
import MemberMultiSelect from '../MemberMultiSelect';
import Modal from '../Modal';
import { post } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { formatApiError } from '../../utils/api';

export type VolunteerSignupTarget = {
  shiftRoleId: number;
  roleName: string;
  shiftLabel: string;
  remainingSpots: number;
  requiresCredentials: boolean;
  callerIsSignedUp: boolean;
};

type VolunteerSignupDialogProps = {
  target: VolunteerSignupTarget;
  onClose: () => void;
  onSuccess: (count: number) => Promise<void>;
};

export default function VolunteerSignupDialog({
  target,
  onClose,
  onSuccess,
}: VolunteerSignupDialogProps) {
  const { member } = useAuth();
  const currentMemberId = member?.id;
  const volunteersInputId = useId();
  const commentsInputId = useId();
  const volunteersLabelId = useId();
  const [selectedIds, setSelectedIds] = useState<number[]>(() =>
    target.callerIsSignedUp || currentMemberId == null ? [] : [currentMemberId],
  );
  const [guestNames, setGuestNames] = useState<string[]>([]);
  const [comments, setComments] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Already signed up: picker is the main action. Otherwise start collapsed behind the link.
  const [showMemberPicker, setShowMemberPicker] = useState(() => target.callerIsSignedUp);
  const [memberPickerFocusKey, setMemberPickerFocusKey] = useState(0);

  const totalSelected = selectedIds.length + guestNames.length;
  const maxSelections = target.remainingSpots;
  const selfSelected =
    currentMemberId != null && selectedIds.includes(currentMemberId) && !target.callerIsSignedUp;
  const selfDisplayName = member?.name?.trim() || 'You';

  const revealMemberPicker = (focus: boolean) => {
    setShowMemberPicker(true);
    if (focus) setMemberPickerFocusKey((key) => key + 1);
  };

  const handleSelectedIdsChange = (nextSelectedIds: number[]) => {
    const removedSelf =
      currentMemberId != null &&
      selectedIds.includes(currentMemberId) &&
      !nextSelectedIds.includes(currentMemberId);
    setSelectedIds(nextSelectedIds);
    if (removedSelf) {
      revealMemberPicker(true);
    }
  };

  const removeSelf = () => {
    if (currentMemberId == null) return;
    setSelectedIds((prev) => prev.filter((id) => id !== currentMemberId));
    revealMemberPicker(true);
  };

  const submit = async () => {
    if (totalSelected < 1) {
      setError('Select at least one volunteer.');
      return;
    }
    if (totalSelected > maxSelections) {
      setError(
        maxSelections === 1
          ? 'Only 1 spot remaining for this role.'
          : `Only ${maxSelections} spots remaining for this role.`
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = (await post(
        '/volunteering/shift-roles/{id}/signups',
        {
          comments: comments.trim() || null,
          memberIds: selectedIds,
          guestNames,
        },
        { id: String(target.shiftRoleId) }
      )) as { count?: number; ids?: number[] };
      await onSuccess(result.count ?? result.ids?.length ?? totalSelected);
    } catch (err) {
      setError(formatApiError(err, 'Failed to sign up'));
    } finally {
      setSubmitting(false);
    }
  };

  if (currentMemberId == null) return null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Sign up · ${target.roleName}`}
      size="lg"
      verticalAlign="start"
      contentOverflow="visible"
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">{target.shiftLabel}</p>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {maxSelections} spot{maxSelections === 1 ? '' : 's'} remaining.
          {target.requiresCredentials
            ? ' This role requires credentials, so only eligible members can be added.'
            : null}
        </p>

        {showMemberPicker ? (
          <FormField
            label="Volunteers"
            htmlFor={volunteersInputId}
            required
            helperText="Confirmation emails are sent to selected members. Non-members can be added by name."
            error={error && totalSelected < 1 ? error : undefined}
          >
            <MemberMultiSelect
              inputId={volunteersInputId}
              selectedIds={selectedIds}
              onChange={handleSelectedIdsChange}
              maxSelections={maxSelections}
              placeholder="Search members..."
              focusRequestKey={memberPickerFocusKey}
              isOptionDisabled={(option) =>
                Boolean(target.callerIsSignedUp && option.id === currentMemberId)
              }
              getOptionStatusText={(option) =>
                target.callerIsSignedUp && option.id === currentMemberId
                  ? 'Already signed up'
                  : null
              }
              extraPills={guestNames.map((name) => ({
                key: `guest:${name}`,
                label: name,
                detail: 'Non-member',
                onRemove: () => setGuestNames((prev) => prev.filter((n) => n !== name)),
              }))}
              manualNameEntry={
                target.requiresCredentials
                  ? undefined
                  : {
                      linkLabel: 'Add non-member by name',
                      inputPlaceholder: 'Full name',
                      addButtonLabel: 'Add',
                      onAdd: (name) => {
                        const trimmed = name.trim();
                        if (!trimmed) return;
                        setGuestNames((prev) =>
                          prev.some((n) => n.toLowerCase() === trimmed.toLowerCase())
                            ? prev
                            : [...prev, trimmed]
                        );
                      },
                    }
              }
            />
          </FormField>
        ) : (
          <FormField
            label="Volunteers"
            labelId={volunteersLabelId}
            required
            error={error && totalSelected < 1 ? error : undefined}
          >
            <div className="space-y-2" role="group" aria-labelledby={volunteersLabelId}>
              {selfSelected ? (
                <div className="flex flex-wrap gap-2">
                  <div className="flex items-center rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-900 focus-within:ring-2 focus-within:ring-primary-teal focus-within:ring-offset-2 dark:bg-gray-700 dark:text-gray-100">
                    <span>{selfDisplayName}</span>
                    <button
                      type="button"
                      onClick={removeSelf}
                      className="ml-2 rounded-full p-0.5 focus:outline-none"
                      aria-label={`Remove ${selfDisplayName}`}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ) : null}
              <button
                type="button"
                className="text-sm text-primary-teal-link hover:underline"
                onClick={() => revealMemberPicker(true)}
              >
                Is anyone else joining you?
              </button>
            </div>
          </FormField>
        )}

        <FormField
          label="Comments"
          htmlFor={commentsInputId}
          optional
          helperText="Visible to the owners of this volunteer program."
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

        {error && totalSelected >= 1 ? (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={submitting || totalSelected < 1}>
            {submitting ? 'Signing up…' : 'Confirm signup'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
