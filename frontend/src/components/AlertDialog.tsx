import { HiXMark } from 'react-icons/hi2';
import Button from './Button';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface AlertDialogProps {
  isOpen: boolean;
  title?: string;
  message: string;
  onClose: () => void;
  variant?: 'info' | 'success' | 'warning' | 'error';
}

export default function AlertDialog({
  isOpen,
  title,
  message,
  onClose,
  variant = 'info',
}: AlertDialogProps) {
  const modalRef = useFocusTrap(isOpen);

  if (!isOpen) return null;

  const variantStyles = {
    info: {
      iconBg: 'bg-blue-100 dark:bg-blue-900/30',
      iconColor: 'text-blue-600 dark:text-blue-300',
      titleColor: 'text-blue-900 dark:text-blue-200',
    },
    success: {
      iconBg: 'bg-green-100 dark:bg-green-900/30',
      iconColor: 'text-green-600 dark:text-green-300',
      titleColor: 'text-green-900 dark:text-green-200',
    },
    warning: {
      iconBg: 'bg-yellow-100 dark:bg-yellow-900/30',
      iconColor: 'text-yellow-600 dark:text-yellow-300',
      titleColor: 'text-yellow-900 dark:text-yellow-200',
    },
    error: {
      iconBg: 'bg-red-100 dark:bg-red-900/30',
      iconColor: 'text-red-600 dark:text-red-300',
      titleColor: 'text-red-900 dark:text-red-200',
    },
  };

  const styles = variantStyles[variant];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        <div
          className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
          onClick={onClose}
        />

        <div
          ref={modalRef}
          className="relative bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl max-w-md w-full p-6"
        >
          <div className="flex items-start">
            <div className={`flex-shrink-0 ${styles.iconBg} rounded-full p-2`}>
              <div className={`w-6 h-6 ${styles.iconColor}`}>
                {variant === 'error' && (
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                )}
                {variant === 'success' && (
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
                {variant === 'warning' && (
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                )}
                {variant === 'info' && (
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                )}
              </div>
            </div>

            <div className="ml-4 flex-1">
              {title && (
                <h3 className={`text-lg font-semibold mb-2 ${styles.titleColor}`}>{title}</h3>
              )}
              <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{message}</p>
            </div>

            <button
              onClick={onClose}
              className="ml-4 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
            >
              <HiXMark className="w-5 h-5" />
            </button>
          </div>

          <div className="mt-6 flex justify-end">
            <Button onClick={onClose}>OK</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
