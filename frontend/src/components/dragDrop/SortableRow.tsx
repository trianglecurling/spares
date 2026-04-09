import type { ReactNode } from 'react';

type SortableRowProps = {
  children: ReactNode;
  className?: string;
  isDragging?: boolean;
  isOverlay?: boolean;
};

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export default function SortableRow({
  children,
  className,
  isDragging = false,
  isOverlay = false,
}: SortableRowProps) {
  return (
    <div
      className={joinClasses(
        'rounded-xl border border-gray-200/90 bg-white/95 p-4 shadow-sm transition-all dark:border-gray-700/90 dark:bg-gray-800/95',
        isDragging && 'border-primary-teal/60 shadow-lg ring-2 ring-primary-teal/15',
        isOverlay && 'pointer-events-none shadow-xl ring-2 ring-primary-teal/20',
        className
      )}
    >
      {children}
    </div>
  );
}
