import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { HiXMark, HiExclamationTriangle } from 'react-icons/hi2';
import Button from './Button';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface ConfirmDialogProps {
  isOpen: boolean;
  title?: string;
  message: string;
  /** Optional body below the message (forms, choice groups, etc.). */
  children?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  children,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'warning',
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const modalRef = useFocusTrap(isOpen);

  // Allow Escape key to cancel the dialog
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        onCancel();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const variantStyles = {
    danger: {
      iconBg: 'bg-red-100 dark:bg-red-900/30',
      iconColor: 'text-red-600 dark:text-red-300',
      titleColor: 'text-red-900 dark:text-red-200',
      buttonVariant: 'danger' as const,
    },
    warning: {
      iconBg: 'bg-yellow-100 dark:bg-yellow-900/30',
      iconColor: 'text-yellow-600 dark:text-yellow-300',
      titleColor: 'text-yellow-900 dark:text-yellow-200',
      buttonVariant: 'secondary' as const,
    },
    info: {
      iconBg: 'bg-blue-100 dark:bg-blue-900/30',
      iconColor: 'text-blue-600 dark:text-blue-300',
      titleColor: 'text-blue-900 dark:text-blue-200',
      buttonVariant: 'primary' as const,
    },
  };

  const styles = variantStyles[variant];

  return createPortal(
    <div className="fixed inset-0 z-[120] overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="fixed inset-0 bg-black bg-opacity-50 transition-opacity" aria-hidden />

        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? 'confirm-dialog-title' : undefined}
          className="relative w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-800"
        >
          <div className="flex items-start">
            <div className={`flex-shrink-0 ${styles.iconBg} rounded-full p-2`}>
              <HiExclamationTriangle className={`w-6 h-6 ${styles.iconColor}`} />
            </div>

            <div className="ml-4 flex-1">
              {title ? (
                <h3 id="confirm-dialog-title" className={`mb-2 text-lg font-semibold ${styles.titleColor}`}>
                  {title}
                </h3>
              ) : null}
              <p className="whitespace-pre-wrap text-gray-700 dark:text-gray-300">{message}</p>
              {children ? <div className="mt-4">{children}</div> : null}
            </div>

            <button
              type="button"
              onClick={onCancel}
              className="ml-4 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
              aria-label="Close confirmation dialog"
            >
              <HiXMark className="w-5 h-5" />
            </button>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" onClick={onCancel}>
              {cancelText}
            </Button>
            <Button variant={styles.buttonVariant} onClick={onConfirm} disabled={confirmDisabled}>
              {confirmText}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
