import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import AppStateCard from '../../components/AppStateCard';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import InlineStateMessage from '../../components/InlineStateMessage';
import MemberMultiSelect from '../../components/MemberMultiSelect';
import Modal from '../../components/Modal';
import IncludeArchivedToggle from '../../components/softDelete/IncludeArchivedToggle';
import { useAlert } from '../../contexts/AlertContext';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import api, { formatApiError } from '../../utils/api';
import { memberHasCredentialsManageScope } from '../../utils/credentialAccess';
import { isArchivedAt } from '../../utils/softDelete';
import { localDateOnly } from '../../utils/volunteering';
import { expiredGrantCount, type CredentialAdmin } from './adminCredentialsShared';

const emptyForm = () => ({
  name: '',
  description: '',
  pointOfContactEmail: '',
  managerIds: [] as number[],
});

export default function AdminMemberCredentials() {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const { member } = useAuth();
  const baseId = useId();
  const canManageAllCredentials = memberHasCredentialsManageScope(member);

  const [loading, setLoading] = useState(true);
  const [credentials, setCredentials] = useState<CredentialAdmin[]>([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<CredentialAdmin | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/members/admin/credentials', {
        params: includeArchived ? { includeArchived: '1' } : undefined,
      });
      setCredentials((res.data?.credentials || []) as CredentialAdmin[]);
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to load credentials'), 'error');
    } finally {
      setLoading(false);
    }
  }, [includeArchived, showAlert]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setEditorOpen(true);
  };

  const openEdit = (cred: CredentialAdmin) => {
    setEditing(cred);
    setForm({
      name: cred.name,
      description: cred.description || '',
      pointOfContactEmail: cred.pointOfContactEmail,
      managerIds: cred.managers.map((manager) => manager.id),
    });
    setEditorOpen(true);
  };

  const resetEditor = () => {
    setEditorOpen(false);
    setEditing(null);
    setForm(emptyForm());
  };

  const closeEditor = () => {
    if (saving) return;
    resetEditor();
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        pointOfContactEmail: form.pointOfContactEmail.trim(),
        managerIds: form.managerIds,
      };
      if (editing) {
        await api.patch(`/members/admin/credentials/${editing.id}`, payload);
        showAlert('Credential updated', 'success');
      } else {
        await api.post('/members/admin/credentials', payload);
        showAlert('Credential created', 'success');
      }
      resetEditor();
      await load();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to save credential'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (cred: CredentialAdmin) => {
    const ok = await confirm({
      title: 'Archive credential',
      message: `Archive "${cred.name}"? It will be hidden from new role requirements and the volunteering hub. Existing grants stay in place.`,
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.post(`/members/admin/credentials/${cred.id}/archive`);
      showAlert('Credential archived', 'success');
      await load();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to archive credential'), 'error');
    }
  };

  const handleRestore = async (cred: CredentialAdmin) => {
    const ok = await confirm({
      title: 'Restore credential',
      message: `Restore "${cred.name}"? It will appear in credential lists again.`,
      variant: 'info',
    });
    if (!ok) return;
    try {
      await api.post(`/members/admin/credentials/${cred.id}/restore`);
      showAlert('Credential restored', 'success');
      await load();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to restore credential'), 'error');
    }
  };

  const today = localDateOnly();

  if (loading) {
    return <AppStateCard title="Loading credentials..." />;
  }

  return (
    <>
      <AppPageControlsRow
        left={
          <IncludeArchivedToggle checked={includeArchived} onChange={setIncludeArchived} />
        }
        right={
          canManageAllCredentials ? (
            <Button type="button" onClick={openCreate}>
              New credential
            </Button>
          ) : null
        }
      />

      {credentials.length === 0 ? (
        <AppStateCard
          title={includeArchived ? 'No credentials match these filters.' : 'No credentials yet.'}
          description={
            includeArchived
              ? 'No archived credentials to show.'
              : canManageAllCredentials
                ? 'Create a credential to start granting it to members.'
                : undefined
          }
          action={
            canManageAllCredentials && !includeArchived ? (
              <Button type="button" onClick={openCreate}>
                New credential
              </Button>
            ) : undefined
          }
        />
      ) : (
        <section className="space-y-3">
          {credentials.map((cred) => {
            const archived = isArchivedAt(cred.archivedAt);
            const expiredCount = expiredGrantCount(cred.grants, today);
            return (
              <div key={cred.id} className="app-card w-full p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/admin/members/credentials/${cred.id}`}
                        className="font-medium text-primary-teal-link hover:underline"
                      >
                        {cred.name}
                      </Link>
                      {cred.systemKey ? (
                        <span className="rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                          System
                        </span>
                      ) : null}
                      {archived ? (
                        <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                          Archived
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                      {cred.pointOfContactEmail}
                    </div>
                    <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      {cred.systemKey
                        ? 'Granted automatically'
                        : `${cred.grants.length} member${cred.grants.length === 1 ? '' : 's'}${
                            expiredCount > 0 ? ` · ${expiredCount} expired` : ''
                          }`}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button type="button" variant="secondary" onClick={() => openEdit(cred)}>
                      Edit
                    </Button>
                    {canManageAllCredentials && !cred.systemKey ? (
                      archived ? (
                        <Button type="button" variant="secondary" onClick={() => void handleRestore(cred)}>
                          Restore
                        </Button>
                      ) : (
                        <Button type="button" variant="secondary" onClick={() => void handleArchive(cred)}>
                          Archive
                        </Button>
                      )
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      )}

      <Modal
        isOpen={editorOpen}
        onClose={closeEditor}
        title={editing ? 'Edit credential' : 'New credential'}
        size="lg"
        contentOverflow="visible"
        verticalAlign="start"
      >
        <form onSubmit={(event) => void handleSave(event)} className="space-y-4">
          {editing?.systemKey ? (
            <InlineStateMessage
              title="System credential"
              description={
                editing.systemGrantRule ||
                'This credential is granted automatically. You can edit its label and contact details, but not who holds it.'
              }
            />
          ) : null}
          <FormField label="Name" htmlFor={`${baseId}-name`} required>
            <input
              id={`${baseId}-name`}
              className="app-input"
              value={form.name}
              onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
              required
            />
          </FormField>
          <FormField label="Description" htmlFor={`${baseId}-desc`}>
            <textarea
              id={`${baseId}-desc`}
              className="app-input min-h-[100px]"
              value={form.description}
              onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))}
            />
          </FormField>
          <FormField label="Point of contact email" htmlFor={`${baseId}-email`} required>
            <input
              id={`${baseId}-email`}
              type="email"
              className="app-input"
              value={form.pointOfContactEmail}
              onChange={(e) =>
                setForm((current) => ({ ...current, pointOfContactEmail: e.target.value }))
              }
              required
            />
          </FormField>
          <FormField label="Managers" htmlFor={`${baseId}-managers`}>
            <MemberMultiSelect
              inputId={`${baseId}-managers`}
              selectedIds={form.managerIds}
              onChange={(managerIds) => setForm((current) => ({ ...current, managerIds }))}
              placeholder="Search members..."
            />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={saving || (!canManageAllCredentials && !editing)}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create credential'}
            </Button>
            <Button type="button" variant="secondary" onClick={closeEditor} disabled={saving}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
