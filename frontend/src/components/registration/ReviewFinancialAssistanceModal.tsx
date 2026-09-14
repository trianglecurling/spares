import { useEffect, useId, useState } from 'react';
import Button from '../Button';
import ChoiceInput from '../ChoiceInput';
import FormField from '../FormField';
import InlineStateMessage from '../InlineStateMessage';
import Modal from '../Modal';
import {
  defaultApprovedAssistancePercent,
  financialAssistancePercentOptions,
  financialAssistanceReviewDecision,
  type FinancialAssistanceReviewSummary,
} from './financialAssistanceReviewShared';

type ReviewFinancialAssistanceModalProps = {
  isOpen: boolean;
  saving: boolean;
  memberName: string;
  assistance: FinancialAssistanceReviewSummary;
  error?: string | null;
  onClose: () => void;
  onSubmit: (input: {
    status: 'approved' | 'partially_approved' | 'denied';
    approvedPercentage: number;
    staffNotes: string | null;
  }) => void;
};

export default function ReviewFinancialAssistanceModal({
  isOpen,
  saving,
  memberName,
  assistance,
  error = null,
  onClose,
  onSubmit,
}: ReviewFinancialAssistanceModalProps) {
  const approvedFieldId = useId();
  const notesFieldId = useId();
  const [approvedPercent, setApprovedPercent] = useState(String(defaultApprovedAssistancePercent(assistance)));
  const [staffNotes, setStaffNotes] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setApprovedPercent(String(defaultApprovedAssistancePercent(assistance)));
    setStaffNotes('');
  }, [assistance, isOpen]);

  function handleSubmit() {
    const approvedPercentage = Number(approvedPercent);
    const decision = financialAssistanceReviewDecision(assistance.requestedPercent, approvedPercentage);
    onSubmit({
      status: decision.status,
      approvedPercentage: decision.approvedPercentage,
      staffNotes: staffNotes.trim() || null,
    });
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (saving) return;
        onClose();
      }}
      title="Review financial assistance"
      size="sm"
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {memberName} requested {assistance.requestedPercent}% assistance for Junior Recreational membership.
          Saving applies this discount to the invoice. Send the roster email to bill the discounted amount.
        </p>
        <FormField label="Approved assistance" htmlFor={approvedFieldId} required>
          <ChoiceInput
            inputId={approvedFieldId}
            layout="popover"
            value={approvedPercent}
            onChange={(value) => {
              const next = Array.isArray(value) ? value[0] : value;
              if (!next) return;
              setApprovedPercent(next);
            }}
            options={financialAssistancePercentOptions(assistance.requestedPercent)}
          />
        </FormField>
        <FormField
          label="Staff notes"
          htmlFor={notesFieldId}
          optional
          helperText="Visible to staff only."
        >
          {({ describedBy }) => (
            <textarea
              id={notesFieldId}
              className="app-input min-h-24"
              value={staffNotes}
              onChange={(event) => setStaffNotes(event.target.value)}
              aria-describedby={describedBy}
            />
          )}
        </FormField>
        {error ? <InlineStateMessage tone="error" title={error} /> : null}
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={handleSubmit}>
            {saving ? 'Saving…' : 'Save review'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
