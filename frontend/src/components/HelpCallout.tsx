import { useEffect, useId, useRef, useState } from 'react';
import { HiQuestionMarkCircle } from 'react-icons/hi2';

type HelpCalloutProps = {
  text: string;
  /** Accessible name for the help control. */
  label?: string;
  align?: 'start' | 'end';
  className?: string;
};

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export default function HelpCallout({
  text,
  label = 'More information',
  align = 'start',
  className,
}: HelpCalloutProps) {
  const tooltipId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const open = pinned || hovered;

  useEffect(() => {
    if (!pinned) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setPinned(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [pinned]);

  return (
    <span
      ref={rootRef}
      className={joinClasses('relative inline-flex align-middle', className)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40 dark:text-gray-500 dark:hover:text-gray-300"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        onClick={() => setPinned((value) => !value)}
      >
        <HiQuestionMarkCircle className="h-5 w-5" aria-hidden />
      </button>
      <div
        id={tooltipId}
        role="tooltip"
        className={joinClasses(
          'pointer-events-none absolute top-full z-30 mt-1.5 w-64 max-w-[calc(100vw-2.5rem)] rounded-lg border border-gray-200 bg-white p-3 text-sm font-normal normal-case leading-snug text-gray-600 shadow-lg dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300',
          align === 'end' ? 'right-0' : 'left-0',
          open ? 'block' : 'hidden'
        )}
      >
        {text}
      </div>
    </span>
  );
}
