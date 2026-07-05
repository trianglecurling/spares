import { useId, useMemo, useState, type FormEvent } from 'react';
import { HiPencilSquare, HiTrash } from 'react-icons/hi2';
import api from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { invalidatePublicContactRecipientsCache } from '../../hooks/usePublicContactRecipients';
import { notifyPublicBootstrapChanged } from '../../utils/publicBootstrapClient';
import AppStateCard from '../../components/AppStateCard';
import Button from '../../components/Button';
import DragHandle from '../../components/dragDrop/DragHandle';
import SortableList from '../../components/dragDrop/SortableList';
import SortableRow from '../../components/dragDrop/SortableRow';
import FormCheckbox from '../../components/FormCheckbox';
import FormField from '../../components/FormField';
import FormSection from '../../components/FormSection';
import InlineStateMessage from '../../components/InlineStateMessage';
import Modal from '../../components/Modal';

export type PublicContactRecipientAdminRow = {
  id: number;
  slug: string;
  label: string;
  email: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

const SLUG_FORMAT_RE = /^[a-z0-9-]+$/;

type ContactFormState = {
  slug: string;
  label: string;
  email: string;
  isActive: boolean;
};

const emptyForm = (): ContactFormState => ({
  slug: '',
  label: '',
  email: '',
  isActive: true,
});

type AdminContentContactsPanelProps = {
  rows: PublicContactRecipientAdminRow[];
  loading: boolean;
  saving: boolean;
  onSavingChange: (saving: boolean) => void;
  onRefresh: () => Promise<void>;
};

export default function AdminContentContactsPanel({
  rows,
  loading,
  saving,
  onSavingChange,
  onRefresh,
}: AdminContentContactsPanelProps) {
  const formFieldId = useId();
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<PublicContactRecipientAdminRow | null>(null);
  const [form, setForm] = useState<ContactFormState>(emptyForm);

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
    [rows],
  );

  const slugHelper =
    editingRow == null
      ? 'Lowercase letters, numbers, and hyphens only. Used in contact links and cannot be changed later.'
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

  const openEditModal = (row: PublicContactRecipientAdminRow) => {
    setEditingRow(row);
    setForm({
      slug: row.slug,
      label: row.label,
      email: row.email,
      isActive: row.isActive,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingRow(null);
    setForm(emptyForm());
  };

  const notifyContactsChanged = () => {
    invalidatePublicContactRecipientsCache();
    notifyPublicBootstrapChanged();
  };

  const handleReorder = async (nextRows: PublicContactRecipientAdminRow[]) => {
    onSavingChange(true);
    try {
      await api.patch('/content/contact-recipients/reorder', {
        updates: nextRows.map((row, index) => ({ id: row.id, sortOrder: index * 10 })),
      });
      notifyContactsChanged();
      await onRefresh();
      showAlert('Contact order updated', 'success');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to reorder contacts', 'error');
    } finally {
      onSavingChange(false);
    }
  };

  const handleDelete = async (row: PublicContactRecipientAdminRow) => {
    const ok = await confirm({
      title: 'Delete contact',
      message: `Delete "${row.label}"? Existing links using recipient=${row.slug} will stop working.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;

    onSavingChange(true);
    try {
      await api.delete(`/content/contact-recipients/${row.id}`);
      notifyContactsChanged();
      await onRefresh();
      showAlert('Contact deleted', 'success');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to delete contact', 'error');
    } finally {
      onSavingChange(false);
    }
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    const label = form.label.trim();
    const email = form.email.trim();
    if (!label || !email) return;

    onSavingChange(true);
    try {
      if (editingRow) {
        await api.patch(`/content/contact-recipients/${editingRow.id}`, {
          label,
          email,
          isActive: form.isActive,
        });
        showAlert('Contact updated', 'success');
      } else {
        const slug = form.slug.trim();
        if (!slug || !SLUG_FORMAT_RE.test(slug)) {
          showAlert('Enter a valid slug using lowercase letters, numbers, and hyphens.', 'error');
          return;
        }
        await api.post('/content/contact-recipients', {
          slug,
          label,
          email,
          sortOrder: sortedRows.length * 10,
          isActive: form.isActive,
        });
        showAlert('Contact added', 'success');
      }
      notifyContactsChanged();
      closeModal();
      await onRefresh();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to save contact', 'error');
    } finally {
      onSavingChange(false);
    }
  };

  const canSave =
    form.label.trim().length > 0 &&
    form.email.trim().length > 0 &&
    (editingRow != null || (form.slug.trim().length > 0 && SLUG_FORMAT_RE.test(form.slug.trim())));

  if (loading) {
    return <AppStateCard title="Loading contacts..." />;
  }

  return (
    <>
      <FormSection
        title="Public email contacts"
        description="These options appear on the contact page and in article link dialogs. Drag to reorder. Hidden contacts stay out of public dropdowns unless linked directly."
        surface="plain"
      >
        <div className="mb-4 flex justify-end">
          <Button type="button" onClick={openCreateModal} disabled={saving}>
            Add contact
          </Button>
        </div>

        {sortedRows.length === 0 ? (
          <InlineStateMessage title="No public contacts yet. Add one to get started." />
        ) : (
          <SortableList
            items={sortedRows}
            getId={(row) => row.id}
            getItemLabel={(row) => row.label}
            itemNoun="contact"
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
                        {!row.isActive ? (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                            Hidden
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">{row.email}</div>
                      <div className="mt-1 font-mono text-xs text-gray-500 dark:text-gray-500">
                        recipient={row.slug}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-teal dark:hover:bg-gray-800 dark:hover:text-gray-200"
                      aria-label={`Edit ${row.label}`}
                      onClick={() => openEditModal(row)}
                    >
                      <HiPencilSquare className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1.5 text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-primary-teal dark:text-red-400 dark:hover:bg-red-950/40"
                      aria-label={`Delete ${row.label}`}
                      onClick={() => void handleDelete(row)}
                    >
                      <HiTrash className="h-4 w-4" aria-hidden="true" />
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
        title={editingRow ? 'Edit contact' : 'Add contact'}
      >
        <form onSubmit={(event) => void handleSave(event)} className="space-y-4">
          <FormField
            label="Slug"
            htmlFor={`${formFieldId}-contact-slug`}
            helperText={slugHelper}
            error={slugError}
            required={editingRow == null}
          >
            <input
              id={`${formFieldId}-contact-slug`}
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
          <FormField label="Label" htmlFor={`${formFieldId}-contact-label`} required>
            <input
              id={`${formFieldId}-contact-label`}
              type="text"
              value={form.label}
              onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
              className="app-input"
              required
            />
          </FormField>
          <FormField label="Destination email" htmlFor={`${formFieldId}-contact-email`} required>
            <input
              id={`${formFieldId}-contact-email`}
              type="email"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              className="app-input"
              required
            />
          </FormField>
          <FormCheckbox
            label="Hidden"
            checked={!form.isActive}
            onChange={(isHidden) => setForm((current) => ({ ...current, isActive: !isHidden }))}
            helperText="Hidden contacts will not appear in the public contact dropdown, but articles can still link to the contact page to auto-select a hidden contact."
          />
          <div className="flex justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
            <Button type="button" variant="secondary" onClick={closeModal}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave || saving}>
              {saving ? 'Saving...' : editingRow ? 'Save changes' : 'Add contact'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
