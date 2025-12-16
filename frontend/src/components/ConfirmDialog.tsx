import { useEffect } from 'react';
import { HiXMark, HiExclamationTriangle } from 'react-icons/hi2';
import Button from './Button';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface ConfirmDialogProps {
  isOpen: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'warning',
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

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        <div
          className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        />
        
        <div
          ref={modalRef}
          className="relative bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl max-w-md w-full p-6"
        >
          <div className="flex items-start">
            <div className={`flex-shrink-0 ${styles.iconBg} rounded-full p-2`}>
              <HiExclamationTriangle className={`w-6 h-6 ${styles.iconColor}`} />
            </div>
            
            <div className="ml-4 flex-1">
              {title && (
                <h3 className={`text-lg font-semibold mb-2 ${styles.titleColor}`}>
                  {title}
                </h3>
              )}
              <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{message}</p>
            </div>
            
            <button
              onClick={onCancel}
              className="ml-4 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
            >
              <HiXMark className="w-5 h-5" />
            </button>
          </div>
          
          <div className="mt-6 flex justify-between space-x-3">
            <Button
              variant={styles.buttonVariant}
              onClick={onConfirm}
            >
              {confirmText}
            </Button>
            <Button
              variant="secondary"
              onClick={onCancel}
            >
              {cancelText}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

