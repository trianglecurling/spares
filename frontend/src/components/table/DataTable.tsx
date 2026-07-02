import type { ReactNode } from 'react';
import AppStateCard from '../AppStateCard';
import DataTableHeaderCell from './DataTableHeaderCell';
import DataTablePagination from './DataTablePagination';
import DataTableSelectionCell from './DataTableSelectionCell';
import type {
  DataTableActions,
  DataTableColumn,
  DataTablePaginationState,
  DataTableSelection,
  TableRowId,
  TableSort,
  TableSortDirection,
} from './tableTypes';

type DataTableProps<Row, SortKey extends string, RowId extends TableRowId> = {
  rows: Row[];
  rowKey: (row: Row) => RowId;
  columns: Array<DataTableColumn<Row, SortKey>>;
  sort?: TableSort<SortKey>;
  onSortChange?: (sort: TableSort<SortKey>) => void;
  selection?: DataTableSelection<Row, RowId>;
  actions?: DataTableActions<Row>;
  pagination?: DataTablePaginationState;
  loading?: boolean;
  error?: ReactNode;
  emptyState?: ReactNode;
  className?: string;
  shellClassName?: string;
  getRowClassName?: (row: Row) => string | undefined;
};

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function alignClasses(align: 'left' | 'center' | 'right' = 'left') {
  if (align === 'right') return 'text-right';
  if (align === 'center') return 'text-center';
  return 'text-left';
}

export default function DataTable<Row, SortKey extends string, RowId extends TableRowId>({
  rows,
  rowKey,
  columns,
  sort,
  onSortChange,
  selection,
  actions,
  pagination,
  loading = false,
  error,
  emptyState,
  className,
  shellClassName,
  getRowClassName,
}: DataTableProps<Row, SortKey, RowId>) {
  const selectedIdSet = new Set(selection?.selectedIds ?? []);
  const selectableRows = selection
    ? rows.filter((row) => (selection.isRowSelectable ? selection.isRowSelectable(row) : true))
    : [];
  const allPageSelected =
    selectableRows.length > 0 && selectableRows.every((row) => selectedIdSet.has(rowKey(row)));
  const somePageSelected =
    selectableRows.length > 0 && !allPageSelected && selectableRows.some((row) => selectedIdSet.has(rowKey(row)));

  const colSpan = columns.length + (selection ? 1 : 0) + (actions ? 1 : 0);
  const actionsOnLeft = actions?.position === 'left';
  const actionsHeaderClassName = joinClasses(
    'app-table-th',
    actionsOnLeft ? 'text-left' : 'text-right',
    actions?.widthClassName,
  );
  const actionsCellClassName = joinClasses(
    'app-table-td align-middle',
    actionsOnLeft ? 'text-left' : 'text-right',
    actions?.widthClassName,
  );

  const renderActionsHeader = () =>
    actions ? (
      <th className={actionsHeaderClassName}>
        <div className={actionsOnLeft ? 'text-left' : 'text-right'}>{actions.header ?? 'Actions'}</div>
      </th>
    ) : null;

  const renderActionsCell = (row: Row) =>
    actions ? <td className={actionsCellClassName}>{actions.renderActions(row)}</td> : null;

  const bodyState = loading
    ? (
      <AppStateCard compact title="Loading rows..." />
    )
    : error
      ? error
      : rows.length === 0
        ? (emptyState ?? <AppStateCard compact title="No results found." />)
        : null;

  const handleSort = (sortKey: SortKey, defaultDirection: TableSortDirection) => {
    if (!onSortChange || !sort) return;
    if (sort.key === sortKey) {
      onSortChange({
        key: sortKey,
        direction: sort.direction === 'asc' ? 'desc' : 'asc',
      });
      return;
    }

    onSortChange({
      key: sortKey,
      direction: defaultDirection,
    });
  };

  return (
    <div className={joinClasses('space-y-4', className)}>
      <div className={joinClasses('app-table-shell', shellClassName)}>
        <table className="app-table">
          <thead className="app-table-head">
            <tr>
              {selection ? (
                <th className="app-table-th w-12">
                  <DataTableSelectionCell
                    checked={allPageSelected}
                    indeterminate={somePageSelected}
                    onChange={(checked) => selection.onTogglePage(selectableRows, checked)}
                    ariaLabel="Select all rows on this page"
                    disabled={selectableRows.length === 0}
                  />
                </th>
              ) : null}
              {actionsOnLeft ? renderActionsHeader() : null}
              {columns.map((column) => (
                <DataTableHeaderCell
                  key={column.id}
                  sortable={column.sortable && Boolean(column.sortKey)}
                  active={Boolean(column.sortable && sort && column.sortKey === sort.key)}
                  direction={column.sortable && sort && column.sortKey === sort.key ? sort.direction : 'asc'}
                  align={column.align}
                  className={column.headerClassName}
                  onSort={
                    column.sortable && column.sortKey
                      ? () => handleSort(column.sortKey as SortKey, column.defaultSortDirection ?? 'asc')
                      : undefined
                  }
                >
                  {column.header}
                </DataTableHeaderCell>
              ))}
              {!actionsOnLeft ? renderActionsHeader() : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {bodyState ? (
              <tr>
                <td colSpan={colSpan} className="app-table-td py-6">
                  {bodyState}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const rowId = rowKey(row);
                const isSelectable = selection ? (selection.isRowSelectable ? selection.isRowSelectable(row) : true) : false;
                const isSelected = selection ? selectedIdSet.has(rowId) : false;

                return (
                  <tr
                    key={String(rowId)}
                    className={joinClasses(
                      isSelected && 'bg-blue-50/70 dark:bg-blue-900/20',
                      getRowClassName?.(row)
                    )}
                  >
                    {selection ? (
                      <td className="app-table-td w-12">
                        {isSelectable ? (
                          <DataTableSelectionCell
                            checked={isSelected}
                            onChange={(checked) => selection.onToggleRow(row, checked)}
                            ariaLabel={`Select ${selection.getRowLabel ? selection.getRowLabel(row) : 'row'}`}
                          />
                        ) : null}
                      </td>
                    ) : null}
                    {actionsOnLeft ? renderActionsCell(row) : null}
                    {columns.map((column) => (
                      <td
                        key={column.id}
                        className={joinClasses(
                          'app-table-td align-middle',
                          alignClasses(column.align),
                          column.cellClassName
                        )}
                      >
                        {column.renderCell(row)}
                      </td>
                    ))}
                    {!actionsOnLeft ? renderActionsCell(row) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {pagination ? <DataTablePagination {...pagination} /> : null}
    </div>
  );
}
