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
import { memberHasCredentialsManageScope } from '../../utils/credentialAccess';
import {
  formatVolunteerDateOnly,
  localDateOnly,
  volunteerCredentialIsValidOn,
} from '../../utils/volunteering';

type CredentialGrant = {
  id: number;
  memberId: number;
  memberName: string;
  memberEmail: string | null;
  grantedAt: string;
  grantedByMemberId: number | null;
  expiresAt: string | null;
};

type CredentialAdmin = {
  id: number;
  name: string;
  description: string | null;
  pointOfContactEmail: string;
  managers: Array<{ id: number; name: string; email: string | null }>;
  grants: CredentialGrant[];
};

function expiredGrantCount(grants: CredentialGrant[], today: string): number {
  return grants.filter((grant) => !volunteerCredentialIsValidOn(grant.expiresAt, today)).length;
}

const EMAIL_ADDRESS_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmailAddress(email: string): boolean {
  return EMAIL_ADDRESS_RE.test(email);
}

function credentialHolderEmailEntries(
  grants: CredentialGrant[],
  today: string
): string[] {
  const entries: string[] = [];
  const seenEmails = new Set<string>();
  for (const grant of grants) {
    if (!volunteerCredentialIsValidOn(grant.expiresAt, today)) continue;
    const email = grant.memberEmail?.trim() ?? '';
    if (!email || !isValidEmailAddress(email)) continue;
    const emailKey = email.toLowerCase();
    if (seenEmails.has(emailKey)) continue;
    seenEmails.add(emailKey);
    const displayName = grant.memberName.trim() || email;
    entries.push(`"${displayName}" <${email}>`);
  }
  return entries;
}

export default function AdminMemberCredentials() {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const { member } = useAuth();
  const { options: memberOptions } = useMemberOptions();
  const baseId = useId();
  const canCreate = memberHasCredentialsManageScope(member);

  const [loading, setLoading] = useState(true);
  const [credentials, setCredentials] = useState<CredentialAdmin[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pointOfContactEmail, setPointOfContactEmail] = useState('');
  const [managerIds, setManagerIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [grantMemberIds, setGrantMemberIds] = useState<number[]>([]);
  const [grantExpiresAt, setGrantExpiresAt] = useState('');
  const [granting, setGranting] = useState(false);
  const [revokingMemberId, setRevokingMemberId] = useState<number | null>(null);
  const [savingExpiresMemberId, setSavingExpiresMemberId] = useState<number | null>(null);
  const [selectedCredentialId, setSelectedCredentialId] = useState<number | null>(null);

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    const quiet = opts?.quiet ?? false;
    if (!quiet) setLoading(true);
    try {
      const res = await api.get('/members/admin/credentials');
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
        await api.patch(`/members/admin/credentials/${editingId}`, payload);
        showAlert('Credential updated', 'success');
      } else {
        const res = await api.post('/members/admin/credentials', payload);
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
      await api.delete(`/members/admin/credentials/${cred.id}`);
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
          const res = await api.post(`/members/admin/credentials/${selected.id}/grants`, {
            memberId,
            expiresAt: grantExpiresAt.trim() || null,
          });
          const option = memberOptions.find((m) => m.id === memberId);
          granted.push({
            id: res.data.id as number,
            memberId,
            memberName: option?.name || `Member ${memberId}`,
            memberEmail: option?.email ?? null,
            grantedAt: new Date().toISOString(),
            grantedByMemberId: member?.id ?? null,
            expiresAt: (res.data.expiresAt as string | null | undefined) ?? (grantExpiresAt.trim() || null),
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

  const handleUpdateExpiresAt = async (memberId: number, expiresAt: string | null) => {
    if (!selected) return;
    const previous = selected.grants.find((g) => g.memberId === memberId)?.expiresAt ?? null;
    patchCredential(selected.id, (cred) => ({
      ...cred,
      grants: cred.grants.map((g) => (g.memberId === memberId ? { ...g, expiresAt } : g)),
    }));
    setSavingExpiresMemberId(memberId);
    try {
      await api.patch(`/members/admin/credentials/${selected.id}/grants/${memberId}`, {
        expiresAt,
      });
    } catch (err) {
      patchCredential(selected.id, (cred) => ({
        ...cred,
        grants: cred.grants.map((g) => (g.memberId === memberId ? { ...g, expiresAt: previous } : g)),
      }));
      showAlert(formatApiError(err, 'Failed to update expiration date'), 'error');
    } finally {
      setSavingExpiresMemberId(null);
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
      await api.delete(`/members/admin/credentials/${selected.id}/grants/${memberId}`);
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

  const today = localDateOnly();

  const handleCopyEmails = async () => {
    if (!selected) return;
    const entries = credentialHolderEmailEntries(selected.grants, today);
    if (entries.length === 0) {
      showAlert('No holder emails to copy', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(entries.join(', '));
      showAlert('Holder emails copied', 'success');
    } catch {
      showAlert('Failed to copy emails', 'error');
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
                  inputId={`${baseId}-managers`}
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
            credentials.map((cred) => {
              const expiredCount = expiredGrantCount(cred.grants, today);
              return (
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
                      setGrantExpiresAt('');
                    }}
                  >
                    <div className="font-medium text-gray-900 dark:text-gray-100">{cred.name}</div>
                    <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                      {cred.pointOfContactEmail}
                    </div>
                    <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      {cred.grants.length} member{cred.grants.length === 1 ? '' : 's'}
                      {expiredCount > 0 ? ` · ${expiredCount} expired` : ''}
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
              );
            })
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
                  inputId={`${baseId}-grant`}
                  selectedIds={grantMemberIds}
                  onChange={setGrantMemberIds}
                  placeholder="Search members to grant..."
                />
              </FormField>
              <FormField
                label="Expiration date"
                htmlFor={`${baseId}-grant-expires`}
                optional
                helperText="Leave blank if this credential does not expire. Valid through the selected date."
              >
                <input
                  id={`${baseId}-grant-expires`}
                  type="date"
                  className="app-input w-full max-w-xs"
                  value={grantExpiresAt}
                  onChange={(e) => setGrantExpiresAt(e.target.value)}
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
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-end">
                  <Button type="button" variant="secondary" onClick={() => void handleCopyEmails()}>
                    Copy emails
                  </Button>
                </div>
                <ul className="space-y-2">
                {[...selected.grants]
                  .sort((a, b) => {
                    const aExpired = !volunteerCredentialIsValidOn(a.expiresAt, today);
                    const bExpired = !volunteerCredentialIsValidOn(b.expiresAt, today);
                    if (aExpired !== bExpired) return aExpired ? 1 : -1;
                    return a.memberName.localeCompare(b.memberName);
                  })
                  .map((grant) => {
                    const expired = !volunteerCredentialIsValidOn(grant.expiresAt, today);
                    const expiresInputId = `${baseId}-grant-expires-${grant.id}`;
                    return (
                      <li key={grant.id} className="app-card space-y-3 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-medium">{grant.memberName}</div>
                            {grant.memberEmail ? (
                              <div className="text-sm text-gray-600 dark:text-gray-400">
                                {grant.memberEmail}
                              </div>
                            ) : null}
                            {expired && grant.expiresAt ? (
                              <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                                Expired {formatVolunteerDateOnly(grant.expiresAt)}
                              </p>
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
                        </div>
                        <FormField
                          label="Expiration date"
                          htmlFor={expiresInputId}
                          optional
                          className="mb-0"
                        >
                          <input
                            id={expiresInputId}
                            type="date"
                            className="app-input w-full max-w-xs"
                            value={grant.expiresAt ?? ''}
                            disabled={savingExpiresMemberId === grant.memberId}
                            onChange={(e) => {
                              void handleUpdateExpiresAt(grant.memberId, e.target.value.trim() || null);
                            }}
                          />
                        </FormField>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
