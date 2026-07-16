import { useId } from 'react';

export type ContentFormat = 'markdown' | 'html';

type ContentFormatToggleProps = {
  value: ContentFormat;
  onChange: (next: ContentFormat) => void;
  className?: string;
};

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Segmented Markdown vs HTML/CSS/JS control for article editors.
 */
export default function ContentFormatToggle({
  value,
  onChange,
  className,
}: ContentFormatToggleProps) {
  const labelId = useId();
  const options: Array<{ value: ContentFormat; label: string }> = [
    { value: 'markdown', label: 'Markdown' },
    { value: 'html', label: 'HTML/CSS/JS' },
  ];

  return (
    <div className={joinClasses('flex flex-wrap items-center justify-end gap-2', className)}>
      <div id={labelId} className="app-label mb-0">
        Page source type
      </div>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="inline-flex rounded-lg border border-gray-300 bg-gray-100 p-0.5 dark:border-gray-600 dark:bg-gray-800"
      >
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                if (!selected) onChange(option.value);
              }}
              className={joinClasses(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40',
                selected
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                  : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
