import Button from '../Button';
import type { DataTablePaginationState } from './tableTypes';

type DataTablePaginationProps = DataTablePaginationState & {
  className?: string;
};

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function getPageItems(page: number, totalPages: number): Array<number | 'ellipsis'> {
  const windowSize = 2;
  const firstPage = Math.max(1, page - windowSize);
  const lastPage = Math.min(totalPages, page + windowSize);
  const items: Array<number | 'ellipsis'> = [];

  if (firstPage > 1) {
    items.push(1);
    if (firstPage > 2) items.push('ellipsis');
  }

  for (let current = firstPage; current <= lastPage; current += 1) {
    items.push(current);
  }

  if (lastPage < totalPages) {
    if (lastPage < totalPages - 1) items.push('ellipsis');
    items.push(totalPages);
  }

  return items;
}

export default function DataTablePagination({
  page,
  pageSize,
  totalRecords,
  currentCount,
  onPageChange,
  className,
}: DataTablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const rangeStart = totalRecords === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = totalRecords === 0 ? 0 : Math.min(totalRecords, rangeStart + Math.max(0, currentCount - 1));
  const pageItems = getPageItems(page, totalPages);

  return (
    <div className={joinClasses('flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between', className)}>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Showing {rangeStart}–{rangeEnd} of {totalRecords}
      </p>
      {totalPages > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
          >
            Previous
          </Button>
          {pageItems.map((item, index) =>
            item === 'ellipsis' ? (
              <span key={`ellipsis-${index}`} className="px-1 text-sm text-gray-500 dark:text-gray-400">
                ...
              </span>
            ) : (
              <button
                key={item}
                type="button"
                onClick={() => onPageChange(item)}
                disabled={item === page}
                className={joinClasses(
                  'rounded-md border px-3 py-1.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40',
                  item === page
                    ? 'border-primary-teal bg-primary-teal text-white'
                    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700'
                )}
                aria-current={item === page ? 'page' : undefined}
              >
                {item}
              </button>
            )
          )}
          <Button
            type="button"
            variant="secondary"
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
