import type { DraggableAttributes } from '@dnd-kit/core';
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';
import { HiBars3 } from 'react-icons/hi2';

type DragHandleProps = {
  label: string;
  attributes?: DraggableAttributes;
  listeners?: SyntheticListenerMap;
  disabled?: boolean;
  className?: string;
  setActivatorNodeRef?: (element: HTMLElement | null) => void;
};

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export default function DragHandle({
  label,
  attributes,
  listeners,
  disabled = false,
  className,
  setActivatorNodeRef,
}: DragHandleProps) {
  return (
    <button
      type="button"
      ref={setActivatorNodeRef}
      aria-label={label}
      disabled={disabled}
      {...attributes}
      {...listeners}
      className={joinClasses(
        'inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors touch-none',
        disabled
          ? 'cursor-not-allowed opacity-40'
          : 'cursor-grab hover:bg-gray-100 hover:text-gray-600 active:cursor-grabbing dark:hover:bg-gray-700 dark:hover:text-gray-200',
        className
      )}
    >
      <HiBars3 className="h-5 w-5" aria-hidden />
    </button>
  );
}
