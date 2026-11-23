import { FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import AppStateCard from '../../components/AppStateCard';
import BackButton from '../../components/BackButton';
import Button from '../../components/Button';
import DataTable from '../../components/table/DataTable';
import type { DataTableColumn } from '../../components/table/tableTypes';
import FormField from '../../components/FormField';
import FormSection from '../../components/FormSection';
import InlineStateMessage from '../../components/InlineStateMessage';
import MarkdownDescriptionEditor, {
  type MarkdownDescriptionEditorRef,
} from '../../components/MarkdownDescriptionEditor';
import MemberMultiSelect from '../../components/MemberMultiSelect';
import { useAlert } from '../../contexts/AlertContext';
import { useTheme } from '../../contexts/ThemeContext';
import api, { formatApiError } from '../../utils/api';
import { downloadBlob, filenameFromDisposition, messageFromBlobError } from '../../utils/fileDownload';

type DonationCollection = {
  id: number;
  name: string;
  slug: string;
  causeName: string;
  description: string | null;
  startDate: string;
  endDate: string;
  minimumAmountMinor: number;
  suggestedAmountsMinor: number[];
  status: 'upcoming' | 'open' | 'ended';
  totalRaisedMinor: number;
  donorCount: number;
  donationCount: number;
  managers: Array<{ id: number; name: string; email: string | null }>;
};

type DonorRow = {
  orderId: number;
  donorName: string;
  donorEmail: string;
  donorPhone: string;
  donatedAt: string;
  amountMinor: number;
  currency: string;
};

function formatMoney(amountMinor: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amountMinor / 100);
}

const DEFAULT_SUGGESTED_AMOUNTS = ['25.00', '50.00', '100.00', '250.00', '500.00'];

function dollarsToMinor(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

export default function AdminDonationCollectionEditor() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const collectionId = !isNew && id ? Number.parseInt(id, 10) : null;
  const navigate = useNavigate();
  const { showAlert } = useAlert();
  const { resolvedTheme } = useTheme();
  const baseId = useId();
  const descriptionLabelId = useId();
  const descriptionEditorRef = useRef<MarkdownDescriptionEditorRef>(null);

  const [loading, setLoading] = useState(!isNew);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [causeName, setCauseName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [minimumAmount, setMinimumAmount] = useState('1.00');
  const [suggestedAmounts, setSuggestedAmounts] = useState<string[]>(DEFAULT_SUGGESTED_AMOUNTS);
  const [description, setDescription] = useState('');
  const [managerIds, setManagerIds] = useState<number[]>([]);
  const [collection, setCollection] = useState<DonationCollection | null>(null);
  const [donors, setDonors] = useState<DonorRow[]>([]);
  const [donorSummary, setDonorSummary] = useState({ totalRaisedMinor: 0, donorCount: 0 });
  const [donorsLoading, setDonorsLoading] = useState(false);
  const [donorsError, setDonorsError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (isNew || collectionId == null || !Number.isFinite(collectionId)) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    api
      .get<{ collection: DonationCollection }>(`/donation-collections/${collectionId}`)
      .then((response) => {
        if (cancelled) return;
        const next = response.data.collection;
        setCollection(next);
        setName(next.name);
        setSlug(next.slug);
        setCauseName(next.causeName);
        setStartDate(next.startDate);
        setEndDate(next.endDate);
        setMinimumAmount((next.minimumAmountMinor / 100).toFixed(2));
        setSuggestedAmounts(
          (next.suggestedAmountsMinor ?? []).map((amount) => (amount / 100).toFixed(2))
        );
        setDescription(next.description ?? '');
        setManagerIds(next.managers.map((manager) => manager.id));
      })
      .catch((error) => {
        if (cancelled) return;
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status === 404) {
          setNotFound(true);
          return;
        }
        showAlert(formatApiError(error, 'Failed to load donation collection'), 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [collectionId, isNew, showAlert]);

  useEffect(() => {
    if (collectionId == null || !Number.isFinite(collectionId)) return;
    let cancelled = false;
    setDonorsLoading(true);
    setDonorsError(null);
    api
      .get<{ totalRaisedMinor: number; donorCount: number; donors: DonorRow[] }>(
        `/donation-collections/${collectionId}/donors`
      )
      .then((response) => {
        if (cancelled) return;
        setDonors(response.data.donors ?? []);
        setDonorSummary({
          totalRaisedMinor: response.data.totalRaisedMinor ?? 0,
          donorCount: response.data.donorCount ?? 0,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setDonors([]);
        setDonorsError(formatApiError(error, 'Failed to load donors'));
      })
      .finally(() => {
        if (!cancelled) setDonorsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [collectionId]);

  const donorColumns: Array<DataTableColumn<DonorRow>> = useMemo(
    () => [
      { id: 'name', header: 'Name', renderCell: (row) => row.donorName },
      { id: 'email', header: 'Email', renderCell: (row) => row.donorEmail || '—' },
      { id: 'phone', header: 'Phone', renderCell: (row) => row.donorPhone || '—' },
      { id: 'when', header: 'Date and time', renderCell: (row) => row.donatedAt },
      {
        id: 'amount',
        header: 'Amount',
        align: 'right',
        renderCell: (row) => formatMoney(row.amountMinor, row.currency),
      },
    ],
    []
  );

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    const minimumAmountMinor = dollarsToMinor(minimumAmount);
    if (minimumAmountMinor == null || minimumAmountMinor < 100) {
      showAlert('Enter a minimum donation of at least $1.00.', 'error');
      return;
    }
    const suggestedAmountsMinor: number[] = [];
    for (const value of suggestedAmounts) {
      if (!value.trim()) continue;
      const amountMinor = dollarsToMinor(value);
      if (amountMinor == null || amountMinor < 100) {
        showAlert('Enter each suggested amount in dollars, such as 25.00.', 'error');
        return;
      }
      suggestedAmountsMinor.push(amountMinor);
    }
    const markdown = descriptionEditorRef.current?.getMarkdown?.() ?? description;
    setSaving(true);
    const payload = {
      name: name.trim(),
      slug: slug.trim() || null,
      causeName: causeName.trim(),
      description: markdown.trim() || null,
      startDate,
      endDate,
      minimumAmountMinor,
      suggestedAmountsMinor,
      managerIds,
    };
    try {
      if (isNew) {
        const response = await api.post<{ collection: DonationCollection }>('/donation-collections', payload);
        showAlert('Donation collection created.', 'success');
        navigate(`/admin/donations/${response.data.collection.id}`);
        return;
      }
      const response = await api.patch<{ collection: DonationCollection }>(
        `/donation-collections/${collectionId}`,
        payload
      );
      const next = response.data.collection;
      setCollection(next);
      setSlug(next.slug);
      setDescription(next.description ?? '');
      setSuggestedAmounts(next.suggestedAmountsMinor.map((amount) => (amount / 100).toFixed(2)));
      showAlert('Donation collection saved.', 'success');
    } catch (error) {
      showAlert(formatApiError(error, 'Failed to save donation collection'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    if (collectionId == null || exporting) return;
    setExporting(true);
    try {
      const response = await api.get(`/donation-collections/${collectionId}/donors/export`, {
        responseType: 'blob',
      });
      downloadBlob(
        new Blob([response.data], { type: 'text/csv;charset=utf-8' }),
        filenameFromDisposition(response.headers['content-disposition'], 'donors.csv')
      );
    } catch (error) {
      showAlert(await messageFromBlobError(error, 'Unable to export donors.'), 'error');
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <AppPage>
        <AppStateCard title="Loading donation collection..." />
      </AppPage>
    );
  }

  if (notFound || (!isNew && (collectionId == null || !Number.isFinite(collectionId)))) {
    return (
      <AppPage>
        <AppStateCard
          title="Donation collection not found"
          description="This collection may have been removed, or you may not have access to it."
          action={<BackButton label="Donation collections" to="/admin/donations" />}
        />
      </AppPage>
    );
  }

  return (
    <AppPage>
      <AppPageHeader
        title={isNew ? 'New donation collection' : name || 'Donation collection'}
        description="Set the public page, dates, minimum gift, and who can manage this collection. The QuickBooks item name is set under Manage payments, on the Item names tab."
        actions={<BackButton label="Donation collections" to="/admin/donations" />}
      />

      <form onSubmit={handleSave} className="space-y-6">
        <FormSection title="Collection" surface="panel">
          <FormField label="Name" htmlFor={`${baseId}-name`} required>
            <input
              id={`${baseId}-name`}
              className="app-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={160}
            />
          </FormField>
          <FormField
            label="Slug"
            htmlFor={`${baseId}-slug`}
            helperText="Leave this blank to create a slug from the name. The public page is /donations/your-slug."
          >
            <input
              id={`${baseId}-slug`}
              className="app-input"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              maxLength={120}
              placeholder="auto-generated-from-name"
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Start date" htmlFor={`${baseId}-start`} required>
              <input
                id={`${baseId}-start`}
                type="date"
                className="app-input"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                required
              />
            </FormField>
            <FormField label="End date" htmlFor={`${baseId}-end`} required>
              <input
                id={`${baseId}-end`}
                type="date"
                className="app-input"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                required
              />
            </FormField>
          </div>
          <FormField
            label="Fundraising cause"
            htmlFor={`${baseId}-cause`}
            required
            helperText="Shown to donors and used in the confirmation email."
          >
            <input
              id={`${baseId}-cause`}
              className="app-input"
              value={causeName}
              onChange={(event) => setCauseName(event.target.value)}
              required
              maxLength={160}
            />
          </FormField>
          <FormField
            label="Minimum donation amount"
            htmlFor={`${baseId}-minimum`}
            required
            helperText="Donors cannot give less than this amount. Enter dollars, such as 25.00."
          >
            <input
              id={`${baseId}-minimum`}
              className="app-input"
              inputMode="decimal"
              value={minimumAmount}
              onChange={(event) => setMinimumAmount(event.target.value)}
              required
            />
          </FormField>
          <div role="group" aria-labelledby={`${baseId}-suggested-label`} className="space-y-3">
            <div>
              <div id={`${baseId}-suggested-label`} className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Suggested amounts
              </div>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                These appear as buttons on the donation page. Each amount must be at least the minimum. You can add up to 12. Leave this empty to show no buttons.
              </p>
            </div>
            {suggestedAmounts.map((value, index) => (
              <div key={`${baseId}-suggested-row-${index}`} className="flex items-end gap-3">
                <FormField
                  className="min-w-0 flex-1"
                  label={`Suggested amount ${index + 1}`}
                  htmlFor={`${baseId}-suggested-${index}`}
                >
                  <input
                    id={`${baseId}-suggested-${index}`}
                    className="app-input"
                    inputMode="decimal"
                    value={value}
                    onChange={(event) =>
                      setSuggestedAmounts((current) =>
                        current.map((amount, amountIndex) =>
                          amountIndex === index ? event.target.value : amount
                        )
                      )
                    }
                  />
                </FormField>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    setSuggestedAmounts((current) => current.filter((_, amountIndex) => amountIndex !== index))
                  }
                >
                  Remove amount {index + 1}
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              disabled={suggestedAmounts.length >= 12}
              onClick={() => setSuggestedAmounts((current) => [...current, ''])}
            >
              Add amount
            </Button>
          </div>
          <FormField label="Managers" htmlFor={`${baseId}-managers`} helperText="Managers can edit this collection and export its donors.">
            <MemberMultiSelect
              inputId={`${baseId}-managers`}
              selectedIds={managerIds}
              onChange={setManagerIds}
              placeholder="Search members to add as managers..."
            />
          </FormField>
          {!isNew && collection ? (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Public page:{' '}
              <Link
                to={`/donations/${collection.slug}`}
                className="text-primary-teal-link hover:underline"
              >
                /donations/{collection.slug}
              </Link>
            </p>
          ) : null}
        </FormSection>

        <FormSection title="Description" surface="panel">
          <FormField
            label="Description"
            labelId={descriptionLabelId}
            optional
            helperPlacement="after-label"
            helperText="Shown on the public donation page."
          >
            {({ describedBy }) => (
              <div
                role="group"
                aria-labelledby={descriptionLabelId}
                aria-describedby={describedBy}
                className="flex min-h-[420px] flex-col overflow-hidden rounded-lg border border-gray-300 dark:border-gray-600"
              >
                <MarkdownDescriptionEditor
                  key={isNew ? 'new' : collection?.id}
                  ref={descriptionEditorRef}
                  initialValue={description}
                  dark={resolvedTheme === 'dark'}
                  fill
                />
              </div>
            )}
          </FormField>
        </FormSection>

        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : isNew ? 'Create collection' : 'Save collection'}
        </Button>
      </form>

      {!isNew ? (
        <section className="mt-8 space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="app-card">
              <p className="text-sm text-gray-600 dark:text-gray-400">Total raised</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">
                {formatMoney(donorSummary.totalRaisedMinor)}
              </p>
            </div>
            <div className="app-card">
              <p className="text-sm text-gray-600 dark:text-gray-400">Donors</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">
                {donorSummary.donorCount}
              </p>
            </div>
            <div className="app-card">
              <p className="text-sm text-gray-600 dark:text-gray-400">Donations</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">{donors.length}</p>
            </div>
          </div>
          <AppPageControlsRow
            left={
              <div>
                <h2 className="app-section-title">Donors</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">Completed donations. The export includes name, email, phone, date and time, and amount.</p>
              </div>
            }
            right={
              <Button variant="secondary" onClick={() => void handleExport()} disabled={exporting || donorsLoading}>
                {exporting ? 'Exporting…' : 'Export CSV'}
              </Button>
            }
          />
          {donorsError ? (
            <InlineStateMessage title="Unable to load donors" description={donorsError} tone="error" />
          ) : (
            <DataTable
              rows={donors}
              rowKey={(row) => row.orderId}
              columns={donorColumns}
              loading={donorsLoading}
              emptyState={
                <AppStateCard
                  compact
                  title="No donations yet"
                  description="Completed donations will appear here."
                />
              }
            />
          )}
        </section>
      ) : null}
    </AppPage>
  );
}
