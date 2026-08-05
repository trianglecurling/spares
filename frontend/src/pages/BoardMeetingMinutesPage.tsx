import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { HiPencilSquare, HiTrash } from 'react-icons/hi2';
import { AppPage, AppPageHeader } from '../components/AppPage';
import AppStateCard from '../components/AppStateCard';
import Button from '../components/Button';
import FormField from '../components/FormField';
import Modal from '../components/Modal';
import { useAlert } from '../contexts/AlertContext';
import { useConfirm } from '../contexts/ConfirmContext';
import api, { formatApiError } from '../utils/api';

type MinutesItem = {
  id: number;
  meetingDate: string;
  documentUrl: string;
  comment: string | null;
};

type FiscalYearGroup = {
  fiscalYearStartYear: number;
  label: string;
  minutes: MinutesItem[];
};

type MinutesListResponse = {
  canManage: boolean;
  fiscalYearStartMmdd: string;
  fiscalYears: FiscalYearGroup[];
};

type FormState = {
  meetingDate: string;
  documentUrl: string;
  comment: string;
};

const emptyForm = (): FormState => ({
  meetingDate: '',
  documentUrl: '',
  comment: '',
});

function formatMeetingDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map((part) => Number.parseInt(part, 10));
  if (!y || !m || !d) return isoDate;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export default function BoardMeetingMinutesPage() {
  const formId = useId();
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [fiscalYears, setFiscalYears] = useState<FiscalYearGroup[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MinutesItem | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<MinutesListResponse>('/board-meeting-minutes');
      setCanManage(Boolean(res.data?.canManage));
      setFiscalYears(Array.isArray(res.data?.fiscalYears) ? res.data.fiscalYears : []);
    } catch (err: unknown) {
      setError(formatApiError(err, 'Unable to load board meeting minutes.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setModalOpen(true);
  };

  const openEdit = (item: MinutesItem) => {
    setEditing(item);
    setForm({
      meetingDate: item.meetingDate,
      documentUrl: item.documentUrl,
      comment: item.comment ?? '',
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    setForm(emptyForm());
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.meetingDate.trim() || !form.documentUrl.trim()) {
      showAlert('Meeting date and document URL are required.', 'warning');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        meetingDate: form.meetingDate.trim(),
        documentUrl: form.documentUrl.trim(),
        comment: form.comment.trim() || null,
      };
      if (editing) {
        await api.patch(`/board-meeting-minutes/${editing.id}`, payload);
        showAlert('Meeting minutes updated', 'success');
      } else {
        await api.post('/board-meeting-minutes', payload);
        showAlert('Meeting minutes added', 'success');
      }
      closeModal();
      await load();
    } catch (err: unknown) {
      showAlert(formatApiError(err, 'Failed to save meeting minutes'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item: MinutesItem) => {
    const ok = await confirm({
      title: 'Delete meeting minutes',
      message: `Delete minutes for ${formatMeetingDate(item.meetingDate)}? This cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/board-meeting-minutes/${item.id}`);
      showAlert('Meeting minutes deleted', 'success');
      await load();
    } catch (err: unknown) {
      showAlert(formatApiError(err, 'Failed to delete meeting minutes'), 'error');
    }
  };

  if (loading) {
    return (
      <AppPage>
        <AppPageHeader title="Board meeting minutes" />
        <AppStateCard title="Loading board meeting minutes..." />
      </AppPage>
    );
  }

  if (error) {
    return (
      <AppPage>
        <AppPageHeader title="Board meeting minutes" />
        <AppStateCard title="Unable to load board meeting minutes" description={error} />
      </AppPage>
    );
  }

  const total = fiscalYears.reduce((sum, group) => sum + group.minutes.length, 0);

  return (
    <>
      <AppPage>
        <AppPageHeader
          title="Board meeting minutes"
          description="Official minutes from club board meetings and annual general membership meetings, organized by fiscal year."
          actions={
            canManage ? (
              <Button type="button" onClick={openCreate}>
                Add minutes
              </Button>
            ) : undefined
          }
        />

        {total === 0 ? (
          <AppStateCard
            title="No meeting minutes yet"
            description="When minutes are published, they will appear here by fiscal year."
            action={
              canManage ? (
                <Button type="button" onClick={openCreate}>
                  Add the first minutes
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-6">
            {fiscalYears.map((group) => (
              <section key={group.fiscalYearStartYear} className="app-card p-6">
                <h2 className="app-section-title mb-4">{group.label}</h2>
                <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                  {group.minutes.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="min-w-0">
                        <a
                          href={item.documentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-primary-teal-link hover:underline"
                        >
                          {formatMeetingDate(item.meetingDate)}
                        </a>
                        {item.comment ? (
                          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{item.comment}</p>
                        ) : null}
                      </div>
                      {canManage ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-teal dark:hover:bg-gray-800 dark:hover:text-gray-200"
                            aria-label={`Edit minutes for ${formatMeetingDate(item.meetingDate)}`}
                            onClick={() => openEdit(item)}
                          >
                            <HiPencilSquare className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="rounded p-1.5 text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-primary-teal dark:text-red-400 dark:hover:bg-red-950/40"
                            aria-label={`Delete minutes for ${formatMeetingDate(item.meetingDate)}`}
                            onClick={() => void handleDelete(item)}
                          >
                            <HiTrash className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </AppPage>

      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editing ? 'Edit meeting minutes' : 'Add meeting minutes'}
      >
        <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
          <FormField label="Meeting date" htmlFor={`${formId}-date`} required>
            <input
              id={`${formId}-date`}
              type="date"
              className="app-input"
              value={form.meetingDate}
              onChange={(e) => setForm((f) => ({ ...f, meetingDate: e.target.value }))}
              required
            />
          </FormField>
          <FormField label="Document URL" htmlFor={`${formId}-url`} required>
            <input
              id={`${formId}-url`}
              type="url"
              className="app-input"
              value={form.documentUrl}
              onChange={(e) => setForm((f) => ({ ...f, documentUrl: e.target.value }))}
              placeholder="https://"
              required
            />
          </FormField>
          <FormField label="Comment" htmlFor={`${formId}-comment`} optional>
            <textarea
              id={`${formId}-comment`}
              className="app-input min-h-[5rem]"
              value={form.comment}
              onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
              rows={3}
            />
          </FormField>
          <div className="flex gap-3">
            <Button type="submit" disabled={saving} className="flex-1">
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" variant="secondary" onClick={closeModal} disabled={saving} className="flex-1">
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
