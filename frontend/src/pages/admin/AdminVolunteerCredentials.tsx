import { useCallback, useEffect, useId, useState } from 'react';
import AppStateCard from '../../components/AppStateCard';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import FormSection from '../../components/FormSection';
import InlineStateMessage from '../../components/InlineStateMessage';
import MemberMultiSelect from '../../components/MemberMultiSelect';
import { useAlert } from '../../contexts/AlertContext';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useMemberOptions } from '../../contexts/MemberOptionsContext';
import api, { formatApiError } from '../../utils/api';
import { memberHasScope } from '../../utils/permissions';

type CredentialGrant = {
  id: number;
  memberId: number;
  memberName: string;
  memberEmail: string | null;
  grantedAt: string;
  grantedByMemberId: number | null;
};

type CredentialAdmin = {
  id: number;
  name: string;
  description: string | null;
  pointOfContactEmail: string;
  managers: Array<{ id: number; name: string; email: string | null }>;
  grants: CredentialGrant[];
};

export default function AdminVolunteerCredentials() {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const { member } = useAuth();
  const { options: memberOptions } = useMemberOptions();
  const baseId = useId();
  const canCreate = memberHasScope(member, 'volunteering.manage') || Boolean(member?.isServerAdmin);

  const [loading, setLoading] = useState(true);
  const [credentials, setCredentials] = useState<CredentialAdmin[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pointOfContactEmail, setPointOfContactEmail] = useState('');
  const [managerIds, setManagerIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [grantMemberIds, setGrantMemberIds] = useState<number[]>([]);
  const [granting, setGranting] = useState(false);
  const [revokingMemberId, setRevokingMemberId] = useState<number | null>(null);
  const [selectedCredentialId, setSelectedCredentialId] = useState<number | null>(null);

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    const quiet = opts?.quiet ?? false;
    if (!quiet) setLoading(true);
    try {
      const res = await api.get('/volunteering/admin/credentials');
      const list = (res.data?.credentials || []) as CredentialAdmin[];
      setCredentials(list);
      setSelectedCredentialId((prev) => {
        if (prev && list.some((c) => c.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to load credentials'), 'error');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [showAlert]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setDescription('');
    setPointOfContactEmail('');
    setManagerIds([]);
  };

  const startEdit = (cred: CredentialAdmin) => {
    setEditingId(cred.id);
    setName(cred.name);
    setDescription(cred.description || '');
    setPointOfContactEmail(cred.pointOfContactEmail);
    setManagerIds(cred.managers.map((m) => m.id));
    setSelectedCredentialId(cred.id);
  };

  const patchCredential = (
    credentialId: number,
    patch: (cred: CredentialAdmin) => CredentialAdmin
  ) => {
    setCredentials((prev) => prev.map((cred) => (cred.id === credentialId ? patch(cred) : cred)));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        pointOfContactEmail: pointOfContactEmail.trim(),
        managerIds,
      };
      if (editingId) {
        await api.patch(`/volunteering/admin/credentials/${editingId}`, payload);
        showAlert('Credential updated', 'success');
      } else {
        const res = await api.post('/volunteering/admin/credentials', payload);
        showAlert('Credential created', 'success');
        setSelectedCredentialId(res.data.id);
      }
      resetForm();
      await load({ quiet: true });
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to save credential'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (cred: CredentialAdmin) => {
    const ok = await confirm({
      title: 'Delete credential',
      message: `Delete "${cred.name}"? Roles requiring it will lose that requirement, and member grants will be removed.`,
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/volunteering/admin/credentials/${cred.id}`);
      showAlert('Credential deleted', 'success');
      if (editingId === cred.id) resetForm();
      setCredentials((prev) => prev.filter((c) => c.id !== cred.id));
      setSelectedCredentialId((prev) => (prev === cred.id ? null : prev));
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to delete credential'), 'error');
    }
  };

  const selected = credentials.find((c) => c.id === selectedCredentialId) || null;

  const handleGrant = async () => {
    if (!selected || grantMemberIds.length === 0) return;
    const alreadyHeld = new Set(selected.grants.map((g) => g.memberId));
    const toGrant = grantMemberIds.filter((id) => !alreadyHeld.has(id));
    if (toGrant.length === 0) {
      setGrantMemberIds([]);
      return;
    }

    setGranting(true);
    const granted: CredentialGrant[] = [];
    const failures: string[] = [];
    try {
      for (const memberId of toGrant) {
        try {
          const res = await api.post(`/volunteering/admin/credentials/${selected.id}/grants`, {
            memberId,
          });
          const option = memberOptions.find((m) => m.id === memberId);
          granted.push({
            id: res.data.id as number,
            memberId,
            memberName: option?.name || `Member ${memberId}`,
            memberEmail: option?.email ?? null,
            grantedAt: new Date().toISOString(),
            grantedByMemberId: member?.id ?? null,
          });
        } catch (err) {
          failures.push(formatApiError(err, `Failed to grant to member ${memberId}`));
        }
      }

      if (granted.length > 0) {
        patchCredential(selected.id, (cred) => ({
          ...cred,
          grants: [...granted, ...cred.grants],
        }));
      }
      if (failures.length > 0) {
        showAlert(failures[0], 'error');
      }
      setGrantMemberIds([]);
    } finally {
      setGranting(false);
    }
  };

  const handleRevoke = async (memberId: number, memberName: string) => {
    if (!selected) return;
    const ok = await confirm({
      title: 'Revoke credential',
      message: `Revoke "${selected.name}" from ${memberName}?`,
      variant: 'danger',
    });
    if (!ok) return;
    setRevokingMemberId(memberId);
    try {
      await api.delete(`/volunteering/admin/credentials/${selected.id}/grants/${memberId}`);
      patchCredential(selected.id, (cred) => ({
        ...cred,
        grants: cred.grants.filter((g) => g.memberId !== memberId),
      }));
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to revoke credential'), 'error');
    } finally {
      setRevokingMemberId(null);
    }
  };

  return loading ? (
    <AppStateCard title="Loading credentials..." />
  ) : (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        {(canCreate || editingId) && (
          <form onSubmit={handleSave} className="space-y-4">
            <FormSection
              title={editingId ? 'Edit credential' : 'Create credential'}
              surface="panel"
            >
              <FormField label="Name" htmlFor={`${baseId}-name`} required>
                <input
                  id={`${baseId}-name`}
                  className="app-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </FormField>
              <FormField label="Description" htmlFor={`${baseId}-desc`}>
                <textarea
                  id={`${baseId}-desc`}
                  className="app-input min-h-[100px]"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </FormField>
              <FormField label="Point of contact email" htmlFor={`${baseId}-email`} required>
                <input
                  id={`${baseId}-email`}
                  type="email"
                  className="app-input"
                  value={pointOfContactEmail}
                  onChange={(e) => setPointOfContactEmail(e.target.value)}
                  required
                />
              </FormField>
              <FormField label="Managers" htmlFor={`${baseId}-managers`}>
                <MemberMultiSelect
                  selectedIds={managerIds}
                  onChange={setManagerIds}
                  placeholder="Search members..."
                />
              </FormField>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={saving || (!canCreate && !editingId)}>
                  {saving ? 'Saving…' : editingId ? 'Update' : 'Create'}
                </Button>
                {editingId ? (
                  <Button type="button" variant="secondary" onClick={resetForm}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </FormSection>
          </form>
        )}

        <section className="space-y-3">
          <h2 className="app-section-title">Credentials ({credentials.length})</h2>
          {credentials.length === 0 ? (
            <InlineStateMessage title="No credentials yet." />
          ) : (
            credentials.map((cred) => (
              <div
                key={cred.id}
                className={`app-card w-full p-4 ${
                  selectedCredentialId === cred.id ? 'ring-2 ring-primary-teal' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      setSelectedCredentialId(cred.id);
                      setGrantMemberIds([]);
                    }}
                  >
                    <div className="font-medium text-gray-900 dark:text-gray-100">{cred.name}</div>
                    <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                      {cred.pointOfContactEmail}
                    </div>
                    <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      {cred.grants.length} member{cred.grants.length === 1 ? '' : 's'}
                    </div>
                  </button>
                  <div className="flex gap-2 shrink-0">
                    <Button type="button" variant="secondary" onClick={() => startEdit(cred)}>
                      Edit
                    </Button>
                    {canCreate ? (
                      <Button type="button" variant="secondary" onClick={() => void handleDelete(cred)}>
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          )}
        </section>
      </div>

      <section className="space-y-4">
        {!selected ? (
          <AppStateCard
            title="Select a credential"
            description="Choose a credential to manage member grants."
          />
        ) : (
          <>
            <FormSection title={`Grants · ${selected.name}`} surface="panel">
              {selected.description ? (
                <p className="mb-3 whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-400">
                  {selected.description}
                </p>
              ) : null}
              <FormField label="Grant to members" htmlFor={`${baseId}-grant`}>
                <MemberMultiSelect
                  selectedIds={grantMemberIds}
                  onChange={setGrantMemberIds}
                  placeholder="Search members to grant..."
                />
              </FormField>
              <Button
                type="button"
                disabled={grantMemberIds.length === 0 || granting}
                onClick={() => void handleGrant()}
              >
                {granting
                  ? 'Granting…'
                  : grantMemberIds.length > 1
                    ? 'Grant credentials'
                    : 'Grant credential'}
              </Button>
            </FormSection>

            {selected.grants.length === 0 ? (
              <InlineStateMessage title="No members hold this credential yet." />
            ) : (
              <ul className="space-y-2">
                {selected.grants.map((grant) => (
                  <li
                    key={grant.id}
                    className="app-card flex items-center justify-between gap-3 p-3"
                  >
                    <div>
                      <div className="font-medium">{grant.memberName}</div>
                      {grant.memberEmail ? (
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          {grant.memberEmail}
                        </div>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={revokingMemberId === grant.memberId}
                      onClick={() => void handleRevoke(grant.memberId, grant.memberName)}
                    >
                      {revokingMemberId === grant.memberId ? 'Revoking…' : 'Revoke'}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}
