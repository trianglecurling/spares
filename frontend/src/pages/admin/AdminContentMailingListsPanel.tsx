import { useId, useMemo, useState, type FormEvent } from 'react';
import { HiPencilSquare, HiTrash } from 'react-icons/hi2';
import api from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import AppStateCard from '../../components/AppStateCard';
import Button from '../../components/Button';
import FormCheckbox from '../../components/FormCheckbox';
import FormField from '../../components/FormField';
import FormSection from '../../components/FormSection';
import InlineStateMessage from '../../components/InlineStateMessage';
import Modal from '../../components/Modal';

export type MailingListAdminRow = {
  id: number;
  slug: string;
  mauticSegmentId: number;
  mauticWelcomeEmailId: number | null;
  commentsRecipientEmail: string | null;
  name: string;
  description: string;
  includeQuestionsComments: boolean;
  createdAt: string;
  updatedAt: string;
};

const SLUG_FORMAT_RE = /^[a-z0-9-]+$/;

type MailingListFormState = {
  slug: string;
  mauticSegmentId: string;
  mauticWelcomeEmailId: string;
  commentsRecipientEmail: string;
  name: string;
  description: string;
  includeQuestionsComments: boolean;
};

const emptyForm = (): MailingListFormState => ({
  slug: '',
  mauticSegmentId: '',
  mauticWelcomeEmailId: '',
  commentsRecipientEmail: '',
  name: '',
  description: '',
  includeQuestionsComments: false,
});

type AdminContentMailingListsPanelProps = {
  rows: MailingListAdminRow[];
  loading: boolean;
  saving: boolean;
  onSavingChange: (saving: boolean) => void;
  onRefresh: () => Promise<void>;
};

export default function AdminContentMailingListsPanel({
  rows,
  loading,
  saving,
  onSavingChange,
  onRefresh,
}: AdminContentMailingListsPanelProps) {
  const formFieldId = useId();
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<MailingListAdminRow | null>(null);
  const [form, setForm] = useState<MailingListFormState>(emptyForm);

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id),
    [rows],
  );

  const slugHelper =
    editingRow == null
      ? 'Lowercase letters, numbers, and hyphens only. Used in public URLs and cannot be changed later.'
      : 'Slug is fixed after creation so existing links keep working.';

  const slugError =
    modalOpen && editingRow == null && form.slug.trim() !== '' && !SLUG_FORMAT_RE.test(form.slug.trim())
      ? 'Use lowercase letters, numbers, and hyphens only.'
      : undefined;

  const openCreateModal = () => {
    setEditingRow(null);
    setForm(emptyForm());
    setModalOpen(true);
  };

  const openEditModal = (row: MailingListAdminRow) => {
    setEditingRow(row);
    setForm({
      slug: row.slug,
      mauticSegmentId: String(row.mauticSegmentId),
      mauticWelcomeEmailId: row.mauticWelcomeEmailId != null ? String(row.mauticWelcomeEmailId) : '',
      commentsRecipientEmail: row.commentsRecipientEmail ?? '',
      name: row.name,
      description: row.description,
      includeQuestionsComments: row.includeQuestionsComments,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingRow(null);
    setForm(emptyForm());
  };

  const handleDelete = async (row: MailingListAdminRow) => {
    const ok = await confirm({
      title: 'Delete mailing list',
      message: `Delete "${row.name}"? The public sign-up page at /mailing-list/${row.slug} will stop working.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;

    onSavingChange(true);
    try {
      await api.delete(`/content/mailing-lists/${row.id}`);
      await onRefresh();
      showAlert('Mailing list deleted', 'success');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to delete mailing list', 'error');
    } finally {
      onSavingChange(false);
    }
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    const name = form.name.trim();
    const description = form.description.trim();
    const mauticSegmentId = Number.parseInt(form.mauticSegmentId, 10);
    const welcomeEmailRaw = form.mauticWelcomeEmailId.trim();
    const mauticWelcomeEmailId =
      welcomeEmailRaw === '' ? null : Number.parseInt(welcomeEmailRaw, 10);
    const commentsRecipientEmail = form.commentsRecipientEmail.trim();
    if (!name || !description || !Number.isFinite(mauticSegmentId) || mauticSegmentId <= 0) return;
    if (welcomeEmailRaw !== '' && (!Number.isFinite(mauticWelcomeEmailId!) || mauticWelcomeEmailId! <= 0)) {
      return;
    }
    if (form.includeQuestionsComments && !commentsRecipientEmail) return;

    const payload = {
      mauticSegmentId,
      mauticWelcomeEmailId,
      name,
      description,
      includeQuestionsComments: form.includeQuestionsComments,
      commentsRecipientEmail: form.includeQuestionsComments ? commentsRecipientEmail : null,
    };

    onSavingChange(true);
    try {
      if (editingRow) {
        await api.patch(`/content/mailing-lists/${editingRow.id}`, payload);
        showAlert('Mailing list updated', 'success');
      } else {
        const slug = form.slug.trim();
        if (!slug || !SLUG_FORMAT_RE.test(slug)) {
          showAlert('Enter a valid slug using lowercase letters, numbers, and hyphens.', 'error');
          return;
        }
        await api.post('/content/mailing-lists', { slug, ...payload });
        showAlert('Mailing list added', 'success');
      }
      closeModal();
      await onRefresh();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to save mailing list', 'error');
    } finally {
      onSavingChange(false);
    }
  };

  const canSave =
    form.name.trim().length > 0 &&
    form.description.trim().length > 0 &&
    Number.parseInt(form.mauticSegmentId, 10) > 0 &&
    (!form.includeQuestionsComments || form.commentsRecipientEmail.trim().length > 0) &&
    (editingRow != null || (form.slug.trim().length > 0 && SLUG_FORMAT_RE.test(form.slug.trim())));

  if (loading) {
    return <AppStateCard title="Loading mailing lists..." />;
  }

  return (
    <>
      <FormSection
        title="Mailing lists"
        description="Connect public sign-up pages to Mautic segments. Each list has its own URL at /mailing-list/{slug}."
        surface="plain"
      >
        <div className="mb-4 flex justify-end">
          <Button type="button" onClick={openCreateModal} disabled={saving}>
            Add mailing list
          </Button>
        </div>

        {sortedRows.length === 0 ? (
          <InlineStateMessage title="No mailing lists yet. Add one to get started." />
        ) : (
          <div className="space-y-3">
            {sortedRows.map((row) => (
              <div
                key={row.id}
                className="rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-900"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 dark:text-gray-100">{row.name}</div>
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{row.description}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-500">
                      <span className="font-mono">/mailing-list/{row.slug}</span>
                      <span>Mautic segment {row.mauticSegmentId}</span>
                      {row.mauticWelcomeEmailId != null ? (
                        <span>Welcome email {row.mauticWelcomeEmailId}</span>
                      ) : null}
                      {row.includeQuestionsComments ? (
                        <span>Comments to {row.commentsRecipientEmail}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-teal dark:hover:bg-gray-800 dark:hover:text-gray-200"
                      aria-label={`Edit ${row.name}`}
                      onClick={() => openEditModal(row)}
                    >
                      <HiPencilSquare className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1.5 text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-primary-teal dark:text-red-400 dark:hover:bg-red-950/40"
                      aria-label={`Delete ${row.name}`}
                      onClick={() => void handleDelete(row)}
                    >
                      <HiTrash className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </FormSection>

      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editingRow ? 'Edit mailing list' : 'Add mailing list'}
      >
        <form onSubmit={(event) => void handleSave(event)} className="space-y-4">
          <FormField
            label="Slug"
            htmlFor={`${formFieldId}-mailing-list-slug`}
            helperText={slugHelper}
            error={slugError}
            required={editingRow == null}
          >
            <input
              id={`${formFieldId}-mailing-list-slug`}
              type="text"
              value={form.slug}
              onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))}
              readOnly={editingRow != null}
              className="app-input font-mono text-sm"
              placeholder="membership"
              pattern="[a-z0-9-]+"
              required={editingRow == null}
            />
          </FormField>
          <FormField label="Name" htmlFor={`${formFieldId}-mailing-list-name`} required>
            <input
              id={`${formFieldId}-mailing-list-name`}
              type="text"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              className="app-input"
              required
            />
          </FormField>
          <FormField
            label="Description"
            htmlFor={`${formFieldId}-mailing-list-description`}
            helperText="Shown on the public sign-up page."
            required
          >
            <textarea
              id={`${formFieldId}-mailing-list-description`}
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              className="app-input min-h-[5rem]"
              required
            />
          </FormField>
          <FormField
            label="Mautic segment ID"
            htmlFor={`${formFieldId}-mailing-list-segment`}
            helperText="Numeric ID of the Mautic segment new subscribers are added to."
            required
          >
            <input
              id={`${formFieldId}-mailing-list-segment`}
              type="number"
              min={1}
              step={1}
              value={form.mauticSegmentId}
              onChange={(event) => setForm((current) => ({ ...current, mauticSegmentId: event.target.value }))}
              className="app-input"
              required
            />
          </FormField>
          <FormField
            label="Mautic welcome email ID"
            htmlFor={`${formFieldId}-mailing-list-welcome-email`}
            helperText="Optional. Numeric ID of a Mautic email sent only when someone signs up through this page (not other segment adds). Include {unsubscribe_url} or {unsubscribe_text} in that email template."
          >
            <input
              id={`${formFieldId}-mailing-list-welcome-email`}
              type="number"
              min={1}
              step={1}
              value={form.mauticWelcomeEmailId}
              onChange={(event) =>
                setForm((current) => ({ ...current, mauticWelcomeEmailId: event.target.value }))
              }
              className="app-input"
              placeholder="Leave blank for no welcome email"
            />
          </FormField>
          <FormCheckbox
            label="Include questions and comments field"
            checked={form.includeQuestionsComments}
            onChange={(includeQuestionsComments) =>
              setForm((current) => ({
                ...current,
                includeQuestionsComments,
                commentsRecipientEmail: includeQuestionsComments ? current.commentsRecipientEmail : '',
              }))
            }
            helperText="When enabled, the public page shows an optional textarea. Comments are emailed when provided."
          />
          {form.includeQuestionsComments ? (
            <FormField
              label="Send comments to..."
              htmlFor={`${formFieldId}-mailing-list-comments-email`}
              helperText="Email address that receives optional questions and comments from new sign-ups."
              required
            >
              <input
                id={`${formFieldId}-mailing-list-comments-email`}
                type="email"
                value={form.commentsRecipientEmail}
                onChange={(event) =>
                  setForm((current) => ({ ...current, commentsRecipientEmail: event.target.value }))
                }
                className="app-input"
                required
              />
            </FormField>
          ) : null}
          <div className="flex justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
            <Button type="button" variant="secondary" onClick={closeModal}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave || saving}>
              {saving ? 'Saving...' : editingRow ? 'Save changes' : 'Add mailing list'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
