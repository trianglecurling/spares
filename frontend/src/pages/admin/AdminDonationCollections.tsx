import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import AppStateCard from '../../components/AppStateCard';
import Button from '../../components/Button';
import DataTable from '../../components/table/DataTable';
import type { DataTableColumn } from '../../components/table/tableTypes';
import { useAuth } from '../../contexts/AuthContext';
import api, { formatApiError } from '../../utils/api';
import { memberHasDonationsManageScope } from '../../utils/donationCollectionAccess';

type DonationCollectionManager = {
  id: number;
  name: string;
  email: string | null;
};

type DonationCollectionSummary = {
  id: number;
  name: string;
  slug: string;
  causeName: string;
  startDate: string;
  endDate: string;
  status: 'upcoming' | 'open' | 'ended';
  totalRaisedMinor: number;
  donorCount: number;
  managers: DonationCollectionManager[];
};

const STATUS_LABELS: Record<DonationCollectionSummary['status'], string> = {
  upcoming: 'Upcoming',
  open: 'Open',
  ended: 'Ended',
};

function formatMoney(amountMinor: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amountMinor / 100);
}

function formatYmd(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function AdminDonationCollections() {
  const { member } = useAuth();
  const canCreate = memberHasDonationsManageScope(member);
  const [collections, setCollections] = useState<DonationCollectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<{ collections: DonationCollectionSummary[] }>('/donation-collections')
      .then((response) => {
        if (!cancelled) setCollections(response.data.collections ?? []);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setCollections([]);
          setError(formatApiError(loadError, 'Failed to load donation collections'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const columns: Array<DataTableColumn<DonationCollectionSummary>> = useMemo(
    () => [
      {
        id: 'name',
        header: 'Name',
        renderCell: (row) => (
          <div>
            <Link
              to={`/admin/donations/${row.id}`}
              className="font-medium text-primary-teal-link hover:underline"
            >
              {row.name}
            </Link>
            <div className="text-xs text-gray-500 dark:text-gray-400">{row.slug}</div>
          </div>
        ),
      },
      {
        id: 'cause',
        header: 'Cause',
        renderCell: (row) => row.causeName,
      },
      {
        id: 'dates',
        header: 'Dates',
        renderCell: (row) => `${formatYmd(row.startDate)} – ${formatYmd(row.endDate)}`,
      },
      {
        id: 'status',
        header: 'Status',
        renderCell: (row) => STATUS_LABELS[row.status],
      },
      {
        id: 'raised',
        header: 'Raised',
        align: 'right',
        renderCell: (row) => formatMoney(row.totalRaisedMinor),
      },
      {
        id: 'donors',
        header: 'Donors',
        align: 'right',
        renderCell: (row) => row.donorCount,
      },
      {
        id: 'managers',
        header: 'Managers',
        renderCell: (row) =>
          row.managers.length === 0 ? '—' : row.managers.map((manager) => manager.name).join(', '),
      },
    ],
    []
  );

  return (
    <AppPage>
      <AppPageHeader
        title="Donation collections"
        description="Charity donation drives. Managers can edit a collection and review its donors."
        actions={
          canCreate ? (
            <Link to="/admin/donations/new">
              <Button>New collection</Button>
            </Link>
          ) : null
        }
      />
      <AppPageControlsRow
        left={<p className="text-sm text-gray-600 dark:text-gray-400">Open a collection to edit it or export donors.</p>}
      />
      {error && !loading ? (
        <AppStateCard title="Unable to load donation collections" description={error} />
      ) : (
        <DataTable
          rows={collections}
          rowKey={(row) => row.id}
          columns={columns}
          loading={loading}
          emptyState={
            <AppStateCard
              title="No donation collections"
              description={
                canCreate
                  ? 'Create a collection to start accepting donations for a fundraising cause.'
                  : 'Collections you manage will appear here.'
              }
            />
          }
        />
      )}
    </AppPage>
  );
}
