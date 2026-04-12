import type { ReactNode } from 'react';
import { HiChevronDown, HiChevronUp } from 'react-icons/hi2';
import type { TableSortDirection } from './tableTypes';

type DataTableHeaderCellProps = {
  children: ReactNode;
  sortable?: boolean;
  active?: boolean;
  direction?: TableSortDirection;
  align?: 'left' | 'center' | 'right';
  className?: string;
  onSort?: () => void;
};

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export default function DataTableHeaderCell({
  children,
  sortable = false,
  active = false,
  direction = 'asc',
  align = 'left',
  className,
  onSort,
}: DataTableHeaderCellProps) {
  const ariaSort = sortable ? (active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none') : undefined;

  const alignmentClass =
    align === 'right' ? 'justify-end text-right' : align === 'center' ? 'justify-center text-center' : 'justify-start text-left';

  return (
    <th className={joinClasses('app-table-th', className)} aria-sort={ariaSort}>
      {sortable && onSort ? (
        <button
          type="button"
          onClick={onSort}
          className={joinClasses(
            'inline-flex w-full items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-inherit transition-colors hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-teal/40 dark:hover:text-gray-100',
            alignmentClass
          )}
        >
          <span className="min-w-0">{children}</span>
          <span
            aria-hidden
            className={joinClasses(
              'inline-flex h-4 w-4 shrink-0 items-center justify-center self-center transition-colors',
              active ? 'text-primary-teal' : 'text-gray-400 dark:text-gray-500'
            )}
          >
            {active ? (
              direction === 'asc' ? (
                <HiChevronUp className="h-4 w-4" />
              ) : (
                <HiChevronDown className="h-4 w-4" />
              )
            ) : (
              <span className="flex flex-col items-center justify-center leading-none">
                <HiChevronUp className="-mb-1 h-3.5 w-3.5" />
                <HiChevronDown className="-mt-1 h-3.5 w-3.5" />
              </span>
            )}
          </span>
        </button>
      ) : (
        <div className={alignmentClass}>{children}</div>
      )}
    </th>
  );
}
