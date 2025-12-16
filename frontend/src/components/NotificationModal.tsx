import { useEffect } from 'react';
import { HiXMark, HiCheckCircle, HiXCircle } from 'react-icons/hi2';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface NotificationModalProps {
  isOpen: boolean;
  message: string;
  onClose: () => void;
  variant?: 'success' | 'error';
  autoCloseMs?: number;
}

export default function NotificationModal({
  isOpen,
  message,
  onClose,
  variant = 'success',
  autoCloseMs = 3000,
}: NotificationModalProps) {
  const modalRef = useFocusTrap(isOpen);

  useEffect(() => {
    if (isOpen && variant === 'success' && autoCloseMs > 0) {
      const timer = setTimeout(() => {
        onClose();
      }, autoCloseMs);
      return () => clearTimeout(timer);
    }
  }, [isOpen, variant, autoCloseMs, onClose]);

  if (!isOpen) return null;

  const isSuccess = variant === 'success';

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
            <div
              className={`flex-shrink-0 ${
                isSuccess ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'
              } rounded-full p-2`}
            >
              {isSuccess ? (
                <HiCheckCircle className="w-6 h-6 text-green-600 dark:text-green-300" />
              ) : (
                <HiXCircle className="w-6 h-6 text-red-600 dark:text-red-300" />
              )}
            </div>
            
            <div className="ml-4 flex-1">
              <h3
                className={`text-lg font-semibold mb-1 ${
                  isSuccess ? 'text-green-900 dark:text-green-200' : 'text-red-900 dark:text-red-200'
                }`}
              >
                {isSuccess ? 'Success!' : 'Error'}
              </h3>
              <p className="text-gray-700 dark:text-gray-300">{message}</p>
            </div>
            
            <button
              onClick={onClose}
              className="ml-4 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
            >
              <HiXMark className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

