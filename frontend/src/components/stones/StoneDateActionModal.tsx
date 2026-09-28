import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { formatStoneDate, todayInClub } from '../../utils/curlingStones';
import Button from '../Button';
import FormField from '../FormField';
import Modal from '../Modal';

type StoneDateActionModalProps = {
  title: string;
  description: ReactNode;
  submitLabel: string;
  /** Earliest allowed date (the last position change of the affected stones). */
  minDate?: string;
  showNotes?: boolean;
  onClose: () => void;
  /** Resolve to close; throw to keep the dialog open (the caller reports the error). */
  onSubmit: (values: { effectiveDate: string; notes: string | null }) => Promise<void>;
};

export default function StoneDateActionModal({
  title,
  description,
  submitLabel,
  minDate,
  showNotes = false,
  onClose,
  onSubmit,
}: StoneDateActionModalProps) {
  const formId = useId();
  const [effectiveDate, setEffectiveDate] = useState(todayInClub());
  const [notes, setNotes] = useState('');
  const [dateError, setDateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!effectiveDate) {
      setDateError('Choose a date.');
      return;
    }
    if (minDate && effectiveDate < minDate) {
      setDateError(`Choose ${formatStoneDate(minDate)} or later, the most recent position change.`);
      return;
    }
    setDateError(null);
    setSubmitting(true);
    try {
      await onSubmit({ effectiveDate, notes: notes.trim() || null });
    } catch {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={title}>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="text-sm text-gray-600 dark:text-gray-400">{description}</div>
        <FormField label="Date" htmlFor={`${formId}-date`} required error={dateError}>
          {({ describedBy, invalid }) => (
            <input
              id={`${formId}-date`}
              type="date"
              className="app-input"
              value={effectiveDate}
              min={minDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              aria-describedby={describedBy}
              aria-invalid={invalid}
            />
          )}
        </FormField>
        {showNotes ? (
          <FormField label="Notes" htmlFor={`${formId}-notes`} optional>
            <textarea
              id={`${formId}-notes`}
              className="app-input min-h-[4rem]"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
            />
          </FormField>
        ) : null}
        <div className="flex gap-3">
          <Button type="submit" disabled={submitting} className="flex-1">
            {submitting ? 'Saving...' : submitLabel}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting} className="flex-1">
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
