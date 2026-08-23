import { useEffect, useId, useState } from 'react';
import Button from '../Button';
import FormField from '../FormField';
import InlineStateMessage from '../InlineStateMessage';
import Modal from '../Modal';

type RecordOfflinePaymentModalProps = {
  isOpen: boolean;
  saving: boolean;
  description: string;
  confirmText: string;
  confirmBusyText: string;
  error?: string | null;
  onClose: () => void;
  onSubmit: (note: string) => void;
};

export default function RecordOfflinePaymentModal({
  isOpen,
  saving,
  description,
  confirmText,
  confirmBusyText,
  error = null,
  onClose,
  onSubmit,
}: RecordOfflinePaymentModalProps) {
  const noteId = useId();
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setNote('');
    setNoteError(null);
  }, [isOpen]);

  function handleSubmit() {
    const trimmed = note.trim();
    if (!trimmed) {
      setNoteError('Enter a check number or other explanation.');
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
      title="Record payment received"
      size="sm"
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">{description}</p>
        <FormField
          label="Payment comment"
          htmlFor={noteId}
          required
          helperText="Check number or other explanation."
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
              maxLength={500}
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
          <Button type="button" disabled={saving} onClick={handleSubmit}>
            {saving ? confirmBusyText : confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
