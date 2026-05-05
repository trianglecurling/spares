import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { HiXMark } from 'react-icons/hi2';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  contentOverflow?: 'hidden' | 'visible' | 'auto';
  /** start: anchor near top of viewport (reduces jump when modal height changes) */
  verticalAlign?: 'center' | 'start';
}

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  contentOverflow = 'auto',
  verticalAlign = 'center',
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

  /** Render at document body so dialogs are never nested inside page <form> elements (invalid HTML, breaks submit / navigation). */
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

  /** Keep panel + padding within dvh so the overlay never scrolls (avoids “whole dialog” scrollbar). */
  const panelMaxHClass =
    verticalAlign === 'start'
      ? 'max-h-[calc(100dvh-6rem)]'
      : 'max-h-[calc(100dvh-2rem)]';

  return createPortal(
    <div className="fixed inset-0 z-[110] overflow-hidden">
      <div
        className="absolute inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
        aria-hidden
      />

      <div
        className={
          verticalAlign === 'start'
            ? 'pointer-events-none absolute inset-0 flex items-start justify-center overflow-hidden pt-8 sm:pt-12 pb-8 px-2 sm:px-4'
            : 'pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden p-2 sm:p-4'
        }
      >
        <div
          ref={modalRef}
          className={`pointer-events-auto relative bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl ${sizeClasses[size]} w-full p-4 sm:p-6 ${panelMaxHClass} flex flex-col overflow-hidden`}
        >
          <div className="flex justify-between items-center mb-4 flex-shrink-0">
            <h3 className="text-lg font-semibold text-[#121033] dark:text-gray-100">{title}</h3>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
            >
              <HiXMark className="w-6 h-6" />
            </button>
          </div>
          <div
            className={`flex-1 ${contentOverflowClasses[contentOverflow]} flex flex-col min-h-0 -mx-4 sm:-mx-6 px-4 sm:px-6`}
          >
            {children}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
