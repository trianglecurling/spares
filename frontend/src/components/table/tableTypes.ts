import type { ReactNode } from 'react';

export type TableRowId = string | number;
export type TableSortDirection = 'asc' | 'desc';

export type TableSort<SortKey extends string> = {
  key: SortKey;
  direction: TableSortDirection;
};

export type DataTableColumn<Row, SortKey extends string = never> = {
  id: string;
  header: ReactNode;
  renderCell: (row: Row) => ReactNode;
  sortable?: boolean;
  sortKey?: SortKey;
  defaultSortDirection?: TableSortDirection;
  headerClassName?: string;
  cellClassName?: string;
  align?: 'left' | 'center' | 'right';
};

export type DataTableSelection<Row, RowId extends TableRowId> = {
  selectedIds: RowId[];
  onToggleRow: (row: Row, checked: boolean) => void;
  onTogglePage: (rows: Row[], checked: boolean) => void;
  isRowSelectable?: (row: Row) => boolean;
  getRowLabel?: (row: Row) => string;
};

export type DataTableActions<Row> = {
  header?: ReactNode;
  widthClassName?: string;
  position?: 'left' | 'right';
  renderActions: (row: Row) => ReactNode;
};

export type DataTablePaginationState = {
  page: number;
  pageSize: number;
  totalRecords: number;
  currentCount: number;
  onPageChange: (page: number) => void;
};
