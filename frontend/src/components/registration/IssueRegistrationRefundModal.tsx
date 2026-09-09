import { useEffect, useId, useState } from 'react';
import Button from '../Button';
import FormField from '../FormField';
import InlineStateMessage from '../InlineStateMessage';
import Modal from '../Modal';

type IssueRegistrationRefundModalProps = {
  isOpen: boolean;
  saving: boolean;
  description: string;
  defaultNote: string;
  error?: string | null;
  onClose: () => void;
  onSubmit: (note: string) => void;
};

const NOTE_MAX_LENGTH = 160;

export default function IssueRegistrationRefundModal({
  isOpen,
  saving,
  description,
  defaultNote,
  error = null,
  onClose,
  onSubmit,
}: IssueRegistrationRefundModalProps) {
  const noteId = useId();
  const [note, setNote] = useState(defaultNote);
  const [noteError, setNoteError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setNote(defaultNote);
    setNoteError(null);
  }, [defaultNote, isOpen]);

  function handleSubmit() {
    const trimmed = note.trim();
    if (!trimmed) {
      setNoteError('Enter a refund note.');
      return;
    }
    onSubmit(trimmed);
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (saving) return;
        onClose();
      }}
      title="Issue refund"
      size="sm"
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">{description}</p>
        <FormField
          label="Refund note"
          htmlFor={noteId}
          required
          helperText="Included with the refund sent to the payment provider."
          error={noteError}
        >
          {({ describedBy, invalid }) => (
            <textarea
              id={noteId}
              className="app-input min-h-24"
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                if (noteError) setNoteError(null);
              }}
              maxLength={NOTE_MAX_LENGTH}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              required
            />
          )}
        </FormField>
        {error ? <InlineStateMessage tone="error" title={error} /> : null}
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="danger" disabled={saving} onClick={handleSubmit}>
            {saving ? 'Issuing…' : 'Issue refund'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
