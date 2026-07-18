import { useEffect, useId, useState, type FormEvent } from 'react';
import { post } from '../../api/client';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import FormSection from '../../components/FormSection';
import InlineStateMessage from '../../components/InlineStateMessage';
import MemberMultiSelect from '../../components/MemberMultiSelect';
import Modal from '../../components/Modal';
import { formatApiError } from '../../utils/api';
import type { VolunteerProgramView } from '../../utils/volunteering';

export type ProgramDuplicatePayload = {
  title: string;
  pointOfContact: string;
  location: string | null;
  startDate: string | null;
  managerIds: number[];
};

type Props = {
  sourceProgram: VolunteerProgramView | null;
  onClose: () => void;
  onDuplicated: (programId: number) => void;
};

function formatSourceStartLabel(program: VolunteerProgramView): string {
  if (program.startDate) {
    const [y, m, d] = program.startDate.split('-').map(Number);
    if (y && m && d) {
      return new Date(y, m - 1, d).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }
    return program.startDate;
  }
  if (program.shifts.length > 0) {
    return 'the earliest shift day (source has no start date)';
  }
  return 'none';
}

export default function AdminVolunteerProgramDuplicateModal({
  sourceProgram,
  onClose,
  onDuplicated,
}: Props) {
  const titleInputId = useId();
  const startDateInputId = useId();
  const pointOfContactInputId = useId();
  const locationInputId = useId();
  const managersInputId = useId();

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [pointOfContact, setPointOfContact] = useState('');
  const [location, setLocation] = useState('');
  const [managerIds, setManagerIds] = useState<number[]>([]);

  const hasShifts = (sourceProgram?.shifts.length ?? 0) > 0;

  useEffect(() => {
    if (!sourceProgram) return;
    setTitle(`${sourceProgram.title} (Copy)`);
    setStartDate('');
    setPointOfContact(sourceProgram.pointOfContact);
    setLocation(sourceProgram.location || '');
    setManagerIds(sourceProgram.managers.map((m) => m.id));
    setSubmitError('');
  }, [sourceProgram]);

  const handleClose = () => {
    if (!submitting) onClose();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sourceProgram) return;

    setSubmitError('');
    if (hasShifts && !startDate.trim()) {
      setSubmitError('Start date is required so shift times can be adjusted.');
      return;
    }

    const payload: ProgramDuplicatePayload = {
      title: title.trim(),
      pointOfContact: pointOfContact.trim(),
      location: location.trim() || null,
      startDate: startDate.trim() || null,
      managerIds,
    };

    setSubmitting(true);
    try {
      const response = await post('/volunteering/admin/programs/{id}/duplicate', payload, {
        id: String(sourceProgram.id),
      });
      onDuplicated(response.id);
    } catch (error) {
      setSubmitError(formatApiError(error, 'Failed to duplicate program'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={sourceProgram != null}
      onClose={handleClose}
      title={sourceProgram ? `Duplicate ${sourceProgram.title}` : 'Duplicate program'}
      size="lg"
      verticalAlign="start"
    >
      {sourceProgram ? (
        <form onSubmit={handleSubmit} className="space-y-6">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Review the new program details. Roles and shifts are copied; sign-ups are not. Shift times keep
            the same time of day and move with the new start date.
          </p>

          <FormSection title="New program" surface="panel">
            <FormField label="Title" htmlFor={titleInputId} required>
              <input
                id={titleInputId}
                type="text"
                required
                maxLength={300}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="app-input"
              />
            </FormField>
            <FormField
              label="Start date"
              htmlFor={startDateInputId}
              required={hasShifts}
              optional={!hasShifts}
              helperText={
                hasShifts
                  ? `Source starts on ${formatSourceStartLabel(sourceProgram)}. Shifts move by the same number of days.`
                  : 'Optional. Copied programs without shifts do not need a start date.'
              }
            >
              <input
                id={startDateInputId}
                type="date"
                required={hasShifts}
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="app-input w-full max-w-xs"
              />
            </FormField>
            <FormField label="Point of contact" htmlFor={pointOfContactInputId} required>
              <input
                id={pointOfContactInputId}
                type="text"
                required
                maxLength={320}
                value={pointOfContact}
                onChange={(event) => setPointOfContact(event.target.value)}
                className="app-input"
              />
            </FormField>
            <FormField label="Location" htmlFor={locationInputId} optional>
              <input
                id={locationInputId}
                type="text"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                className="app-input"
              />
            </FormField>
            <FormField
              label="Managers"
              htmlFor={managersInputId}
              helperText="Managers can edit this program’s roles, shifts, and sign-ups."
            >
              <MemberMultiSelect
                inputId={managersInputId}
                selectedIds={managerIds}
                onChange={setManagerIds}
                placeholder="Search members..."
              />
            </FormField>
          </FormSection>

          {submitError ? <InlineStateMessage title={submitError} tone="error" /> : null}

          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={handleClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Duplicating...' : 'Duplicate program'}
            </Button>
          </div>
        </form>
      ) : null}
    </Modal>
  );
}
