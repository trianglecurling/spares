import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import AppStateCard from '../AppStateCard';
import Button from '../Button';
import Modal from '../Modal';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import api, { formatApiError } from '../../utils/api';
import { formatDateInTimeZone } from '../../utils/clubTime';
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
import VolunteerHourLogForm from './VolunteerHourLogForm';
import VolunteerHourLogSignupAlert from './VolunteerHourLogSignupAlert';

function clubToday(): string {
  return formatDateInTimeZone(new Date()) ?? new Date().toISOString().slice(0, 10);
}

export default function VolunteerHourLogsPanel() {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const today = useMemo(() => clubToday(), []);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<VolunteerHourLogView[]>([]);
  const [totalHours, setTotalHours] = useState(0);
  const [formValues, setFormValues] = useState<VolunteerHourLogFormValues>(() =>
    emptyVolunteerHourLogFormValues(today)
  );
  const [formErrors, setFormErrors] = useState<VolunteerHourLogFieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<VolunteerHourLogView | null>(null);
  const [editValues, setEditValues] = useState<VolunteerHourLogFormValues>(() =>
    emptyVolunteerHourLogFormValues(today)
  );
  const [editErrors, setEditErrors] = useState<VolunteerHourLogFieldErrors>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<VolunteerHourLogListResponse>('/volunteering/hour-logs');
      setItems(data.items || []);
      setTotalHours(data.totalHours ?? 0);
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to load your volunteer hours'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    const hoursResult = volunteerHourLogHoursForSubmit(formValues.hours);
    if ('error' in hoursResult) {
      setFormErrors({ hours: hoursResult.error });
      return;
    }
    setSubmitting(true);
    setFormErrors({});
    try {
      await api.post('/volunteering/hour-logs', { ...formValues, hours: hoursResult.hours });
      showAlert('Volunteer hours logged.', 'success');
      setFormValues(emptyVolunteerHourLogFormValues(today));
      await load();
    } catch (err) {
      setFormErrors(volunteerHourLogFieldErrorsFromUnknown(err));
      showAlert(formatApiError(err, 'Could not log volunteer hours'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = (row: VolunteerHourLogView) => {
    setEditing(row);
    setEditValues({
      volunteerDate: row.volunteerDate,
      hours: row.hours,
      description: row.description,
    });
    setEditErrors({});
  };

  const handleSaveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const hoursResult = volunteerHourLogHoursForSubmit(editValues.hours);
    if ('error' in hoursResult) {
      setEditErrors({ hours: hoursResult.error });
      return;
    }
    setSavingEdit(true);
    setEditErrors({});
    try {
      await api.patch(`/volunteering/hour-logs/${editing.id}`, {
        ...editValues,
        hours: hoursResult.hours,
      });
      showAlert('Volunteer hours updated.', 'success');
      setEditing(null);
      await load();
    } catch (err) {
      setEditErrors(volunteerHourLogFieldErrorsFromUnknown(err));
      showAlert(formatApiError(err, 'Could not update volunteer hours'), 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (row: VolunteerHourLogView) => {
    const ok = await confirm({
      title: 'Delete volunteer hours',
      message: `Delete ${formatVolunteerHoursLabel(row.hours)} on ${formatVolunteerDateOnly(row.volunteerDate)}? This removes those hours from your total.`,
      variant: 'danger',
    });
    if (!ok) return;
    setBusyId(row.id);
    try {
      await api.delete(`/volunteering/hour-logs/${row.id}`);
      showAlert('Volunteer hours deleted.', 'success');
      await load();
    } catch (err) {
      showAlert(formatApiError(err, 'Could not delete volunteer hours'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <AppStateCard
        title="Loading your hours"
        description="Fetching self-reported volunteer hours."
      />
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="app-section-title">Log volunteering</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          You may use this tab to log any volunteering conducted outside of an organized sign-up.
          Logging your volunteering here is entirely optional, but it is encouraged. It helps the
          Club understand the wide range of volunteer jobs that goes into running the organization,
          allows us to recognize your efforts, and helps you keep track of your own club activities.
        </p>
        <div className="app-card space-y-4 p-5">
          <VolunteerHourLogSignupAlert />
          <form onSubmit={handleCreate} className="space-y-4">
            <VolunteerHourLogForm
              values={formValues}
              onChange={setFormValues}
              errors={formErrors}
              disabled={submitting}
              maxDate={today}
            />
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : 'Log volunteering'}
            </Button>
          </form>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="app-section-title">Your self-reported hours</h2>
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
          Self-reported total: {formatVolunteerHoursLabel(totalHours)}
        </p>
        {items.length === 0 ? (
          <AppStateCard
            title="No hours logged yet"
            description="Shifts you signed up for on this website are already counted. Log extra time here only when it was not a website signup."
          />
        ) : (
          <ul className="space-y-3">
            {items.map((row) => (
              <li key={row.id} className="app-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium text-gray-900 dark:text-gray-100">
                      {formatVolunteerDateOnly(row.volunteerDate)} · {formatVolunteerHoursLabel(row.hours)}
                    </p>
                    <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">
                      {row.description}
                    </p>
                    {row.createdByMemberId != null && row.createdByMemberId !== row.memberId ? (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Recorded by {row.createdByMemberName || 'a volunteer admin'}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" onClick={() => openEdit(row)}>
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="outline-danger"
                      disabled={busyId === row.id}
                      onClick={() => handleDelete(row)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal
        isOpen={editing != null}
        onClose={() => {
          if (!savingEdit) setEditing(null);
        }}
        title="Edit volunteer hours"
      >
        {editing ? (
          <form onSubmit={handleSaveEdit} className="space-y-4">
            <VolunteerHourLogForm
              values={editValues}
              onChange={setEditValues}
              errors={editErrors}
              disabled={savingEdit}
              maxDate={today}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={savingEdit}
                onClick={() => setEditing(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={savingEdit}>
                {savingEdit ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}
