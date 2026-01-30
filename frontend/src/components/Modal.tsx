import { useEffect, type ReactNode } from 'react';
import { HiXMark } from 'react-icons/hi2';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  contentOverflow?: 'hidden' | 'visible' | 'auto';
}

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  contentOverflow = 'visible',
}: ModalProps) {
  const modalRef = useFocusTrap(isOpen);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-[95vw]',
  };
  const contentOverflowClasses = {
    hidden: 'overflow-hidden',
    visible: 'overflow-visible',
    auto: 'overflow-auto',
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-2 sm:p-4">
        <div
          className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
          onClick={onClose}
        />
        
        <div
          ref={modalRef}
          className={`relative bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl ${sizeClasses[size]} w-full p-4 sm:p-6 max-h-[95vh] flex flex-col`}
        >
          <div className="flex justify-between items-center mb-4 flex-shrink-0">
            <h3 className="text-lg font-semibold text-[#121033] dark:text-gray-100">
              {title}
            </h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
            >
              <HiXMark className="w-6 h-6" />
            </button>
          </div>
          <div className={`flex-1 ${contentOverflowClasses[contentOverflow]} flex flex-col min-h-0`}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

