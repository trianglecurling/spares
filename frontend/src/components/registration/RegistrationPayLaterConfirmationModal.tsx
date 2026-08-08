import Button from '../Button';
import InlineStateMessage from '../InlineStateMessage';
import Modal from '../Modal';

type RegistrationPayLaterConfirmationModalProps = {
  isOpen: boolean;
  saving: boolean;
  paymentDeadlineDisplay: string;
  error?: string | null;
  onClose: () => void;
  onPayNow: () => void;
  onSubmitWithoutPayment: () => void;
};

export default function RegistrationPayLaterConfirmationModal({
  isOpen,
  saving,
  paymentDeadlineDisplay,
  error = null,
  onClose,
  onPayNow,
  onSubmitWithoutPayment,
}: RegistrationPayLaterConfirmationModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Pay later?" size="md" verticalAlign="start">
      <div className="space-y-4">
        <p className="text-sm text-gray-700 dark:text-gray-300">
          If you choose to pay later, you will receive an invoice via email. You must pay before{' '}
          {paymentDeadlineDisplay} to secure your league selections. Are you sure you want to pay later?
        </p>
        {error ? <InlineStateMessage tone="error" title={error} /> : null}
        <div className="flex flex-wrap justify-end gap-3 border-t border-gray-200 pt-4 dark:border-gray-700">
          <Button type="button" variant="secondary" disabled={saving} onClick={onPayNow}>
            Pay now
          </Button>
          <Button type="button" disabled={saving} onClick={onSubmitWithoutPayment}>
            {saving ? 'Submitting…' : 'Submit registration without payment'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
