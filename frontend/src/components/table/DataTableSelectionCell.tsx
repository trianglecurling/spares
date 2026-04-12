import { useEffect, useRef } from 'react';

type DataTableSelectionCellProps = {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
};

export default function DataTableSelectionCell({
  checked,
  indeterminate = false,
  onChange,
  ariaLabel,
  disabled = false,
}: DataTableSelectionCellProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={inputRef}
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      aria-label={ariaLabel}
      disabled={disabled}
      className="rounded border-gray-300 text-primary-teal focus:ring-primary-teal dark:border-gray-600"
    />
  );
}
