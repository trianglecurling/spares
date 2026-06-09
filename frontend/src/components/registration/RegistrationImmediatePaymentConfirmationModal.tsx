import Button from '../Button';
import InlineStateMessage from '../InlineStateMessage';
import Modal from '../Modal';
import { REGISTRATION_IMMEDIATE_PAYMENT_CONFIRMATION_MESSAGE } from './registrationViewEditShared';

type RegistrationImmediatePaymentConfirmationModalProps = {
  isOpen: boolean;
  saving: boolean;
  message?: string;
  error?: string | null;
  onCancel: () => void;
  onContinue: () => void;
};

export default function RegistrationImmediatePaymentConfirmationModal({
  isOpen,
  saving,
  message = REGISTRATION_IMMEDIATE_PAYMENT_CONFIRMATION_MESSAGE,
  error = null,
  onCancel,
  onContinue,
}: RegistrationImmediatePaymentConfirmationModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title="Payment required now" size="md" verticalAlign="start">
      <div className="space-y-4">
        <p className="text-sm text-gray-700 dark:text-gray-300">{message}</p>
        {error ? <InlineStateMessage tone="error" title={error} /> : null}
        <div className="flex flex-wrap justify-end gap-3 border-t border-gray-200 pt-4 dark:border-gray-700">
          <Button type="button" variant="secondary" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={onContinue}>
            {saving ? 'Continuing…' : 'Continue to checkout'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
