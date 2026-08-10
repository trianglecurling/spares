import { useId, useMemo, useState, type FormEvent } from 'react';
import { HiPencilSquare } from 'react-icons/hi2';
import api from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import AppStateCard from '../../components/AppStateCard';
import Button from '../../components/Button';
import DragHandle from '../../components/dragDrop/DragHandle';
import SortableList from '../../components/dragDrop/SortableList';
import SortableRow from '../../components/dragDrop/SortableRow';
import FormCheckbox from '../../components/FormCheckbox';
import FormField from '../../components/FormField';
import FormSection from '../../components/FormSection';
import ChoiceInput, { type ChoiceOption } from '../../components/ChoiceInput';
import InlineStateMessage from '../../components/InlineStateMessage';
import Modal from '../../components/Modal';

export type DashboardSectionConfig = {
  lookAheadDays?: number;
  maxItems?: number;
  maxPrograms?: number;
  maxShiftsPerProgram?: number;
  showWhenEmpty?: boolean;
  defaultExpanded?: boolean;
};

export type DashboardAlertPayload = {
  title: string | null;
  body: string | null;
  expiresAt: string | null;
  variant: string | null;
  icon: string | null;
};

export type DashboardSectionAdminRow = {
  id: number;
  key: string;
  label: string;
  sortOrder: number;
  isEnabled: boolean;
  config: DashboardSectionConfig;
  createdAt: string;
  updatedAt: string;
  alert?: DashboardAlertPayload;
};

const DASHBOARD_ALERT_VARIANT_OPTIONS: ChoiceOption<string>[] = [
  { value: 'info', label: 'Info (blue)' },
  { value: 'warning', label: 'Warning (amber)' },
  { value: 'success', label: 'Success (green)' },
  { value: 'danger', label: 'Danger (red)' },
];

const DASHBOARD_ALERT_ICON_OPTIONS: ChoiceOption<string>[] = [
  { value: 'announcement', label: 'Announcement' },
  { value: 'info', label: 'Info' },
  { value: 'warning', label: 'Warning' },
  { value: 'success', label: 'Success' },
  { value: 'error', label: 'Error' },
  { value: 'none', label: 'No icon' },
];

const EASTERN_TIME_ZONE = 'America/New_York';

type DateTimeParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second?: string;
};

const extractDateTimeParts = (
  date: Date,
  timeZone: string,
  includeSeconds = false,
): DateTimeParts | null => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: includeSeconds ? '2-digit' : undefined,
    hour12: false,
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== 'literal') {
        acc[part.type] = part.value;
      }
      return acc;
    }, {});

  if (!parts.year || !parts.month || !parts.day || !parts.hour || !parts.minute) {
    return null;
  }
  if (includeSeconds && !parts.second) {
    return null;
  }

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
};

const formatEasternDateTime = (value?: string | null): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = extractDateTimeParts(date, EASTERN_TIME_ZONE);
  if (!parts) return '';
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};

const getTimeZoneOffsetMinutes = (date: Date, timeZone: string) => {
  const parts = extractDateTimeParts(date, timeZone, true);
  if (!parts || !parts.second) return 0;
  const utcTime = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (utcTime - date.getTime()) / 60000;
};

const parseEasternDateTimeToIso = (value: string): string => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return '';
  const [, year, month, day, hour, minute] = match;
  const utcGuess = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    0,
  );
  const offsetMinutes = getTimeZoneOffsetMinutes(new Date(utcGuess), EASTERN_TIME_ZONE);
  return new Date(utcGuess - offsetMinutes * 60000).toISOString();
};

type SectionFormState = {
  isEnabled: boolean;
  lookAheadDays: string;
  maxPrograms: string;
  maxShiftsPerProgram: string;
  showWhenEmpty: boolean;
  defaultExpanded: boolean;
  alertTitle: string;
  alertBody: string;
  alertExpiresAt: string;
  alertVariant: string;
  alertIcon: string;
};

const emptyForm = (): SectionFormState => ({
  isEnabled: true,
  lookAheadDays: '',
  maxPrograms: '',
  maxShiftsPerProgram: '',
  showWhenEmpty: false,
  defaultExpanded: false,
  alertTitle: '',
  alertBody: '',
  alertExpiresAt: '',
  alertVariant: 'info',
  alertIcon: 'announcement',
});

function formFromRow(row: DashboardSectionAdminRow): SectionFormState {
  return {
    isEnabled: row.isEnabled,
    lookAheadDays: row.config.lookAheadDays != null ? String(row.config.lookAheadDays) : '',
    maxPrograms: row.config.maxPrograms != null ? String(row.config.maxPrograms) : '',
    maxShiftsPerProgram:
      row.config.maxShiftsPerProgram != null ? String(row.config.maxShiftsPerProgram) : '',
    showWhenEmpty: row.config.showWhenEmpty ?? false,
    defaultExpanded: row.config.defaultExpanded ?? false,
    alertTitle: row.alert?.title ?? '',
    alertBody: row.alert?.body ?? '',
    alertExpiresAt: row.alert?.expiresAt ?? '',
    alertVariant: row.alert?.variant || 'info',
    alertIcon: row.alert?.icon || 'announcement',
  };
}

function hasLookAheadDays(key: string): boolean {
  return (
    key === 'ice_bookings' ||
    key === 'upcoming_games' ||
    key === 'upcoming_volunteering' ||
    key === 'volunteer_opportunities'
  );
}

function hasVolunteerOpportunityLimits(key: string): boolean {
  return key === 'volunteer_opportunities';
}

function hasShowWhenEmpty(key: string): boolean {
  return (
    key === 'upcoming_volunteering' ||
    key === 'my_sparing' ||
    key === 'my_spare_requests' ||
    key === 'cc_requests' ||
    key === 'outstanding_spares' ||
    key === 'filled_spares'
  );
}

function hasDefaultExpanded(key: string): boolean {
  return key === 'filled_spares';
}

type AdminContentDashboardPanelProps = {
  rows: DashboardSectionAdminRow[];
  loading: boolean;
  saving: boolean;
  onSavingChange: (saving: boolean) => void;
  onRefresh: () => Promise<void>;
};

export default function AdminContentDashboardPanel({
  rows,
  loading,
  saving,
  onSavingChange,
  onRefresh,
}: AdminContentDashboardPanelProps) {
  const formFieldId = useId();
  const { showAlert } = useAlert();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<DashboardSectionAdminRow | null>(null);
  const [form, setForm] = useState<SectionFormState>(emptyForm);

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
    [rows],
  );

  const openEditModal = (row: DashboardSectionAdminRow) => {
    setEditingRow(row);
    setForm(formFromRow(row));
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingRow(null);
    setForm(emptyForm());
  };

  const handleReorder = async (nextRows: DashboardSectionAdminRow[]) => {
    onSavingChange(true);
    try {
      await api.patch('/content/dashboard-sections/reorder', {
        updates: nextRows.map((row, index) => ({ id: row.id, sortOrder: index * 10 })),
      });
      await onRefresh();
      showAlert('Dashboard section order updated', 'success');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to reorder dashboard sections', 'error');
    } finally {
      onSavingChange(false);
    }
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingRow) return;

    const payload: {
      isEnabled: boolean;
      config?: DashboardSectionConfig;
      alert?: {
        title: string;
        body: string;
        expiresAt: string | null;
        variant: 'info' | 'warning' | 'success' | 'danger';
        icon: 'none' | 'info' | 'warning' | 'announcement' | 'success' | 'error';
      };
    } = {
      isEnabled: form.isEnabled,
    };

    if (
      hasLookAheadDays(editingRow.key) ||
      hasVolunteerOpportunityLimits(editingRow.key) ||
      hasShowWhenEmpty(editingRow.key) ||
      hasDefaultExpanded(editingRow.key)
    ) {
      const config: DashboardSectionConfig = {};
      if (hasLookAheadDays(editingRow.key)) {
        const days = Number.parseInt(form.lookAheadDays, 10);
        if (!Number.isFinite(days) || days < 1) {
          showAlert('Look-ahead days must be a whole number of at least 1.', 'error');
          return;
        }
        config.lookAheadDays = days;
      }
      if (hasVolunteerOpportunityLimits(editingRow.key)) {
        const maxPrograms = Number.parseInt(form.maxPrograms, 10);
        if (!Number.isFinite(maxPrograms) || maxPrograms < 1) {
          showAlert('Max programs must be a whole number of at least 1.', 'error');
          return;
        }
        const maxShiftsPerProgram = Number.parseInt(form.maxShiftsPerProgram, 10);
        if (!Number.isFinite(maxShiftsPerProgram) || maxShiftsPerProgram < 1) {
          showAlert('Max shifts per program must be a whole number of at least 1.', 'error');
          return;
        }
        config.maxPrograms = maxPrograms;
        config.maxShiftsPerProgram = maxShiftsPerProgram;
      }
      if (hasShowWhenEmpty(editingRow.key)) {
        config.showWhenEmpty = form.showWhenEmpty;
      }
      if (hasDefaultExpanded(editingRow.key)) {
        config.defaultExpanded = form.defaultExpanded;
      }
      payload.config = config;
    }

    if (editingRow.key === 'alert') {
      const allowedVariants = ['info', 'warning', 'success', 'danger'] as const;
      const allowedIcons = ['none', 'info', 'warning', 'announcement', 'success', 'error'] as const;
      payload.alert = {
        title: form.alertTitle,
        body: form.alertBody,
        expiresAt: form.alertExpiresAt || null,
        variant: allowedVariants.includes(form.alertVariant as (typeof allowedVariants)[number])
          ? (form.alertVariant as (typeof allowedVariants)[number])
          : 'info',
        icon: allowedIcons.includes(form.alertIcon as (typeof allowedIcons)[number])
          ? (form.alertIcon as (typeof allowedIcons)[number])
          : 'announcement',
      };
    }

    onSavingChange(true);
    try {
      await api.patch(`/content/dashboard-sections/${editingRow.id}`, payload);
      showAlert('Dashboard section updated', 'success');
      closeModal();
      await onRefresh();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to save dashboard section', 'error');
    } finally {
      onSavingChange(false);
    }
  };

  if (loading) {
    return <AppStateCard title="Loading dashboard sections..." />;
  }

  return (
    <>
      <FormSection
        title="Dashboard sections"
        description="Control which sections appear on every member's dashboard, their order, and section-specific settings. Hidden sections are never shown, even when they have content."
        surface="plain"
      >
        {sortedRows.length === 0 ? (
          <InlineStateMessage title="No dashboard sections are configured yet." />
        ) : (
          <SortableList
            items={sortedRows}
            getId={(row) => row.id}
            getItemLabel={(row) => row.label}
            itemNoun="dashboard section"
            onReorder={(nextRows) => void handleReorder(nextRows)}
            renderItem={({ item: row, isDragging, isOverlay, dragHandle }) => (
              <SortableRow
                isDragging={isDragging}
                isOverlay={isOverlay}
                className="border-gray-200 px-3 py-3 dark:border-gray-700"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    {dragHandle}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium text-gray-900 dark:text-gray-100">{row.label}</div>
                        {!row.isEnabled ? (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                            Hidden
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 font-mono text-xs text-gray-500 dark:text-gray-500">
                        {row.key}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-teal dark:hover:bg-gray-800 dark:hover:text-gray-200"
                      aria-label={`Configure ${row.label}`}
                      onClick={() => openEditModal(row)}
                    >
                      <HiPencilSquare className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </SortableRow>
            )}
            renderOverlay={(row) => (
              <SortableRow isDragging isOverlay className="px-3 py-3">
                <div className="flex items-center gap-3">
                  <DragHandle label={`Reorder ${row.label}`} disabled />
                  <div className="font-medium">{row.label}</div>
                </div>
              </SortableRow>
            )}
          />
        )}
      </FormSection>

      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editingRow ? `Configure ${editingRow.label}` : 'Configure section'}
      >
        <form onSubmit={(event) => void handleSave(event)} className="space-y-4">
          <FormCheckbox
            label="Hidden"
            checked={!form.isEnabled}
            onChange={(isHidden) => setForm((current) => ({ ...current, isEnabled: !isHidden }))}
            helperText="Hidden sections do not appear on any member's dashboard."
          />

          {editingRow?.key === 'alert' ? (
            <>
              <FormField label="Alert title" htmlFor={`${formFieldId}-alert-title`}>
                <input
                  id={`${formFieldId}-alert-title`}
                  type="text"
                  value={form.alertTitle}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, alertTitle: event.target.value }))
                  }
                  className="app-input"
                  placeholder="Monday leagues canceled"
                />
              </FormField>
              <FormField
                label="Alert message"
                htmlFor={`${formFieldId}-alert-body`}
                helperText="Leave both title and message empty to hide the alert even when this section is enabled."
              >
                <textarea
                  id={`${formFieldId}-alert-body`}
                  value={form.alertBody}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, alertBody: event.target.value }))
                  }
                  rows={4}
                  className="app-input"
                  placeholder="Due to icy road conditions, Monday leagues have been canceled."
                />
              </FormField>
              <FormField
                label="Optional expiration (Eastern Time)"
                htmlFor={`${formFieldId}-alert-expires`}
              >
                <input
                  id={`${formFieldId}-alert-expires`}
                  type="datetime-local"
                  value={formatEasternDateTime(form.alertExpiresAt)}
                  onChange={(event) => {
                    const value = event.target.value;
                    setForm((current) => ({
                      ...current,
                      alertExpiresAt: value ? parseEasternDateTimeToIso(value) : '',
                    }));
                  }}
                  className="app-input"
                />
              </FormField>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField label="Alert color" htmlFor={`${formFieldId}-alert-variant`}>
                  <ChoiceInput<string>
                    inputId={`${formFieldId}-alert-variant`}
                    options={DASHBOARD_ALERT_VARIANT_OPTIONS}
                    value={form.alertVariant}
                    onChange={(next) => {
                      if (next != null && !Array.isArray(next)) {
                        setForm((current) => ({ ...current, alertVariant: next }));
                      }
                    }}
                    listboxLabel="Alert color"
                  />
                </FormField>
                <FormField label="Alert icon" htmlFor={`${formFieldId}-alert-icon`}>
                  <ChoiceInput<string>
                    inputId={`${formFieldId}-alert-icon`}
                    options={DASHBOARD_ALERT_ICON_OPTIONS}
                    value={form.alertIcon}
                    onChange={(next) => {
                      if (next != null && !Array.isArray(next)) {
                        setForm((current) => ({ ...current, alertIcon: next }));
                      }
                    }}
                    listboxLabel="Alert icon"
                  />
                </FormField>
              </div>
            </>
          ) : null}

          {editingRow && hasLookAheadDays(editingRow.key) ? (
            <FormField
              label="Look-ahead days"
              htmlFor={`${formFieldId}-look-ahead`}
              helperText="How far ahead this section should look when loading items."
              required
            >
              <input
                id={`${formFieldId}-look-ahead`}
                type="number"
                min={1}
                max={365}
                value={form.lookAheadDays}
                onChange={(event) =>
                  setForm((current) => ({ ...current, lookAheadDays: event.target.value }))
                }
                className="app-input"
                required
              />
            </FormField>
          ) : null}

          {editingRow && hasVolunteerOpportunityLimits(editingRow.key) ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField
                label="Max programs"
                htmlFor={`${formFieldId}-max-programs`}
                helperText="Maximum number of programs to show."
                required
              >
                <input
                  id={`${formFieldId}-max-programs`}
                  type="number"
                  min={1}
                  max={50}
                  value={form.maxPrograms}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, maxPrograms: event.target.value }))
                  }
                  className="app-input"
                  required
                />
              </FormField>
              <FormField
                label="Max shifts per program"
                htmlFor={`${formFieldId}-max-shifts`}
                helperText="Maximum shifts listed under each program."
                required
              >
                <input
                  id={`${formFieldId}-max-shifts`}
                  type="number"
                  min={1}
                  max={50}
                  value={form.maxShiftsPerProgram}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      maxShiftsPerProgram: event.target.value,
                    }))
                  }
                  className="app-input"
                  required
                />
              </FormField>
            </div>
          ) : null}

          {editingRow && hasShowWhenEmpty(editingRow.key) ? (
            <FormCheckbox
              label="Show when empty"
              checked={form.showWhenEmpty}
              onChange={(showWhenEmpty) => setForm((current) => ({ ...current, showWhenEmpty }))}
              helperText="When off, this section is hidden if there is nothing to show."
            />
          ) : null}

          {editingRow && hasDefaultExpanded(editingRow.key) ? (
            <FormCheckbox
              label="Expanded by default"
              checked={form.defaultExpanded}
              onChange={(defaultExpanded) => setForm((current) => ({ ...current, defaultExpanded }))}
              helperText="When on, the filled spare requests list starts expanded."
            />
          ) : null}

          {editingRow &&
          editingRow.key !== 'alert' &&
          !hasLookAheadDays(editingRow.key) &&
          !hasVolunteerOpportunityLimits(editingRow.key) &&
          !hasShowWhenEmpty(editingRow.key) &&
          !hasDefaultExpanded(editingRow.key) ? (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              This section has no additional settings beyond visibility and order.
            </p>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
            <Button type="button" variant="secondary" onClick={closeModal}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save changes'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
