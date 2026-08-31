import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import AppStateCard from '../../components/AppStateCard';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import MemberAutocomplete from '../../components/MemberAutocomplete';
import Modal from '../../components/Modal';
import DataTable from '../../components/table/DataTable';
import type { DataTableColumn } from '../../components/table/tableTypes';
import useTableQueryState from '../../hooks/useTableQueryState';
import { useAlert } from '../../contexts/AlertContext';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import api, { formatApiError } from '../../utils/api';
import { formatClubDate, formatDateInTimeZone } from '../../utils/clubTime';
import { memberHasScope } from '../../utils/permissions';
import {
  emptyVolunteerHourLogFormValues,
  formatVolunteerDateOnly,
  formatVolunteerHoursLabel,
  volunteerHourLogFieldErrorsFromUnknown,
  volunteerHourLogHoursForSubmit,
  type VolunteerHourLogFieldErrors,
  type VolunteerHourLogFormValues,
  type VolunteerHourLogListResponse,
  type VolunteerHourLogView,
} from '../../utils/volunteering';
import VolunteerHourLogForm from '../../components/volunteering/VolunteerHourLogForm';

const SORT_KEYS = ['volunteerDate', 'hours', 'memberName', 'createdAt'] as const;

function clubToday(): string {
  return formatDateInTimeZone(new Date()) ?? new Date().toISOString().slice(0, 10);
}

export default function AdminVolunteerHourLogs() {
  const { member } = useAuth();
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const searchId = useId();
  const memberInputId = useId();
  const today = useMemo(() => clubToday(), []);
  const canManage = memberHasScope(member, 'volunteering.manage') || Boolean(member?.isServerAdmin);
  const { page, sort, filters, draftFilters, setPage, setSort, setDraftFilter } = useTableQueryState<
    (typeof SORT_KEYS)[number],
    { search: string }
  >({
    defaultSort: { key: 'volunteerDate', direction: 'desc' },
    sortKeys: SORT_KEYS,
    filterConfig: {
      search: { queryKey: 'q', defaultValue: '', debounceMs: 300 },
    },
  });
  const [items, setItems] = useState<VolunteerHourLogView[]>([]);
  const [total, setTotal] = useState(0);
  const [totalHours, setTotalHours] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<VolunteerHourLogView | null>(null);
  const [memberId, setMemberId] = useState<number | ''>('');
  const [formValues, setFormValues] = useState<VolunteerHourLogFormValues>(() =>
    emptyVolunteerHourLogFormValues(today)
  );
  const [formErrors, setFormErrors] = useState<VolunteerHourLogFieldErrors>({});
  const [saving, setSaving] = useState(false);
  const pageSize = 25;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<VolunteerHourLogListResponse>('/volunteering/admin/hour-logs', {
        params: {
          page,
          pageSize,
          search: filters.search || undefined,
          sort: sort.key,
          order: sort.direction,
        },
      });
      setItems(data.items || []);
      setTotal(data.total ?? 0);
      setTotalHours(data.totalHours ?? 0);
    } catch (err) {
      setError(formatApiError(err, 'Failed to load self-reported hours'));
    } finally {
      setLoading(false);
    }
  }, [filters.search, page, sort.direction, sort.key]);

  useEffect(() => {
    if (!canManage) return;
    void load();
  }, [canManage, load]);

  const openCreate = () => {
    setEditing(null);
    setMemberId('');
    setFormValues(emptyVolunteerHourLogFormValues(today));
    setFormErrors({});
    setEditorOpen(true);
  };

  const openEdit = (row: VolunteerHourLogView) => {
    setEditing(row);
    setMemberId(row.memberId);
    setFormValues({
      volunteerDate: row.volunteerDate,
      hours: row.hours,
      description: row.description,
    });
    setFormErrors({});
    setEditorOpen(true);
  };

  const closeEditor = () => {
    if (saving) return;
    setEditorOpen(false);
    setEditing(null);
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (memberId === '') {
      setFormErrors({ memberId: 'Select a member.' });
      return;
    }
    const hoursResult = volunteerHourLogHoursForSubmit(formValues.hours);
    if ('error' in hoursResult) {
      setFormErrors({ hours: hoursResult.error });
      return;
    }
    setSaving(true);
    setFormErrors({});
    const payload = { ...formValues, hours: hoursResult.hours, memberId };
    try {
      if (editing) {
        await api.patch(`/volunteering/admin/hour-logs/${editing.id}`, payload);
        showAlert('Volunteer hours updated.', 'success');
      } else {
        await api.post('/volunteering/admin/hour-logs', payload);
        showAlert('Volunteer hours added.', 'success');
      }
      setEditorOpen(false);
      setEditing(null);
      await load();
    } catch (err) {
      setFormErrors(volunteerHourLogFieldErrorsFromUnknown(err));
      showAlert(formatApiError(err, 'Could not save volunteer hours'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: VolunteerHourLogView) => {
    const ok = await confirm({
      title: 'Delete volunteer hours',
      message: `Delete ${formatVolunteerHoursLabel(row.hours)} for ${row.memberName} on ${formatVolunteerDateOnly(row.volunteerDate)}? This removes those hours from their total.`,
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/volunteering/admin/hour-logs/${row.id}`);
      showAlert('Volunteer hours deleted.', 'success');
      await load();
    } catch (err) {
      showAlert(formatApiError(err, 'Could not delete volunteer hours'), 'error');
    }
  };

  const columns: Array<DataTableColumn<VolunteerHourLogView, (typeof SORT_KEYS)[number]>> = useMemo(
    () => [
      {
        id: 'volunteerDate',
        header: 'Date',
        sortable: true,
        sortKey: 'volunteerDate',
        cellClassName: 'whitespace-nowrap',
        renderCell: (row) => formatVolunteerDateOnly(row.volunteerDate),
      },
      {
        id: 'memberName',
        header: 'Member',
        sortable: true,
        sortKey: 'memberName',
        renderCell: (row) => row.memberName,
      },
      {
        id: 'hours',
        header: 'Hours',
        sortable: true,
        sortKey: 'hours',
        align: 'right',
        renderCell: (row) => formatVolunteerHoursLabel(row.hours),
      },
      {
        id: 'description',
        header: 'How they volunteered',
        cellClassName: 'max-w-md',
        renderCell: (row) => <span className="line-clamp-3">{row.description}</span>,
      },
      {
        id: 'createdAt',
        header: 'Recorded',
        sortable: true,
        sortKey: 'createdAt',
        cellClassName: 'text-sm text-gray-600 dark:text-gray-400',
        renderCell: (row) => {
          const recorded =
            row.createdByMemberId != null && row.createdByMemberId !== row.memberId
              ? ` by ${row.createdByMemberName || 'a volunteer admin'}`
              : '';
          return `${formatClubDate(row.createdAt)}${recorded}`;
        },
      },
    ],
    []
  );

  if (!canManage) {
    return (
      <AppStateCard
        title="You don’t have access"
        description="Self-reported hours can be managed by volunteer admins."
      />
    );
  }

  return (
    <>
      <AppPageControlsRow
        left={
          <FormField label="Search" htmlFor={searchId} className="mb-0">
            <input
              id={searchId}
              className="app-input"
              value={draftFilters.search}
              onChange={(event) => setDraftFilter('search', event.target.value)}
              placeholder="Member, email, or description"
            />
          </FormField>
        }
        right={
          <Button type="button" onClick={openCreate}>
            Add hours
          </Button>
        }
      />

      {!loading && !error ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {total === 0
            ? 'No self-reported hours yet.'
            : `${formatVolunteerHoursLabel(totalHours)} across ${total === 1 ? '1 report' : `${total} reports`}.`}
        </p>
      ) : null}

      {loading ? (
        <AppStateCard title="Loading hours" description="Fetching self-reported volunteer hours." />
      ) : error ? (
        <AppStateCard title="Could not load hours" description={error} />
      ) : (
        <DataTable
          rows={items}
          rowKey={(row) => row.id}
          columns={columns}
          sort={sort}
          onSortChange={setSort}
          pagination={{
            page,
            pageSize,
            totalRecords: total,
            currentCount: items.length,
            onPageChange: setPage,
          }}
          emptyState={
            <AppStateCard
              compact
              title="No self-reported hours"
              description="No reports match these filters."
            />
          }
          actions={{
            widthClassName: 'w-40',
            renderActions: (row) => (
              <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => openEdit(row)}>
                  Edit
                </Button>
                <Button type="button" variant="outline-danger" onClick={() => handleDelete(row)}>
                  Delete
                </Button>
              </div>
            ),
          }}
        />
      )}

      <Modal
        isOpen={editorOpen}
        onClose={closeEditor}
        title={editing ? 'Edit volunteer hours' : 'Add volunteer hours'}
      >
        <form onSubmit={handleSave} className="space-y-4">
          <VolunteerHourLogForm
            values={formValues}
            onChange={setFormValues}
            errors={formErrors}
            disabled={saving}
            maxDate={today}
            memberField={
              <FormField label="Member" htmlFor={memberInputId} required error={formErrors.memberId}>
                <MemberAutocomplete
                  inputId={memberInputId}
                  value={memberId}
                  onChange={setMemberId}
                  placeholder="Search members..."
                  disabled={saving}
                />
              </FormField>
            }
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" disabled={saving} onClick={closeEditor}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add hours'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
