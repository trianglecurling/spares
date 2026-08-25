import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { get } from '../api/client';
import { AppPage, AppPageHeader } from '../components/AppPage';
import AppStateCard from '../components/AppStateCard';
import Button from '../components/Button';
import DataTable from '../components/table/DataTable';
import type { DataTableColumn } from '../components/table/tableTypes';
import { formatApiError } from '../utils/api';
import {
  expenseKindLabel,
  formatExpenseMoney,
  formatSubmittedAt,
  type ExpenseReportListItem,
} from '../utils/expenseReports';

export default function MemberExpenses() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ExpenseReportListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await get('/expenses', { page: 1, pageSize: 100 });
        setItems(response.items ?? []);
      } catch (err) {
        setError(formatApiError(err, 'Failed to load expense reports'));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const columns: Array<DataTableColumn<ExpenseReportListItem>> = useMemo(
    () => [
      {
        id: 'submitted',
        header: 'Submitted',
        cellClassName: 'whitespace-nowrap',
        renderCell: (row) => formatSubmittedAt(row.submittedAt),
      },
      {
        id: 'type',
        header: 'Type',
        renderCell: (row) => expenseKindLabel(row.kind),
      },
      {
        id: 'amount',
        header: 'Amount',
        renderCell: (row) => formatExpenseMoney(row.requestedAmountMinor, row.requestedCurrency),
      },
      {
        id: 'status',
        header: 'Status',
        renderCell: (row) => row.statusLabel,
      },
    ],
    []
  );

  return (
    <AppPage>
      <AppPageHeader
        title="Expense reports"
        description="Track the reimbursement reports you have submitted."
        actions={
          <Link to="/expenses/new">
            <Button type="button">Submit an expense report</Button>
          </Link>
        }
      />
      {loading ? (
        <AppStateCard title="Loading" description="Loading your expense reports." />
      ) : error ? (
        <AppStateCard title="Could not load reports" description={error} />
      ) : items.length === 0 ? (
        <AppStateCard
          title="No expense reports yet"
          description="Submit a reimbursement report when you have an expense or mileage claim."
          action={
            <Link to="/expenses/new">
              <Button type="button">Submit an expense report</Button>
            </Link>
          }
        />
      ) : (
        <DataTable
          rows={items}
          rowKey={(row) => row.id}
          columns={columns}
          onRowClick={(row) => navigate(`/expenses/${row.id}`)}
          actions={{
            header: 'View',
            renderActions: (row) => (
              <Button type="button" variant="secondary" onClick={() => navigate(`/expenses/${row.id}`)}>
                View
              </Button>
            ),
          }}
        />
      )}
    </AppPage>
  );
}
