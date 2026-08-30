import { FormEvent, useCallback, useEffect, useId, useMemo, useState } from 'react';
import api, { formatApiError } from '../../utils/api';
import Button from '../../components/Button';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppStateCard from '../../components/AppStateCard';
import DataTable from '../../components/table/DataTable';
import type { DataTableColumn } from '../../components/table/tableTypes';
import FormField from '../../components/FormField';
import FormSection from '../../components/FormSection';
import FormCheckbox from '../../components/FormCheckbox';
import Modal from '../../components/Modal';
import { useAlert } from '../../contexts/AlertContext';
import { dateTimeLocalToIsoOrNull, formatClubDateTime } from '../../utils/clubTime';
import { useConfirm } from '../../contexts/ConfirmContext';

type AssignableRole = {
  id: number;
  code: string;
  name: string;
  isAssignable: number | boolean;
  isComputed?: number | boolean;
};

type ServiceAccountRole = {
  id: number;
  code: string;
  name: string;
};

type ServiceAccount = {
  id: number;
  name: string;
  email: string | null;
  createdAt: string | Date;
  tokenCount: number;
  roles: ServiceAccountRole[];
};

type PersonalAccessTokenRow = {
  id: number;
  name: string;
  tokenPrefix: string;
  createdAt: string | Date;
  lastUsedAt: string | Date | null;
  expiresAt: string | Date | null;
  revokedAt: string | Date | null;
};

function isTruthyFlag(value: number | boolean | undefined): boolean {
  return value === true || value === 1;
}

function formatTimestamp(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return formatClubDateTime(value) || '—';
}

function RoleChecklist({
  roles,
  selectedIds,
  onChange,
  legendId,
}: {
  roles: AssignableRole[];
  selectedIds: number[];
  onChange: (next: number[]) => void;
  legendId: string;
}) {
  return (
    <div role="group" aria-labelledby={legendId} className="space-y-2">
      {roles.map((role) => (
        <FormCheckbox
          key={role.id}
          label={role.name}
          checked={selectedIds.includes(role.id)}
          onChange={(checked) => {
            onChange(
              checked ? [...selectedIds, role.id] : selectedIds.filter((id) => id !== role.id)
            );
          }}
        />
      ))}
    </div>
  );
}

export default function AdminServiceAccounts() {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const nameFieldId = useId();
  const roleLegendId = useId();
  const tokenNameId = useId();
  const tokenExpiryId = useId();
  const editNameId = useId();
  const editRoleLegendId = useId();

  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<ServiceAccount[]>([]);
  const [roles, setRoles] = useState<AssignableRole[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tokens, setTokens] = useState<PersonalAccessTokenRow[]>([]);
  const [tokensLoading, setTokensLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createRoleIds, setCreateRoleIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  const [mintOpen, setMintOpen] = useState(false);
  const [mintName, setMintName] = useState('Website helper');
  const [mintExpiry, setMintExpiry] = useState('');
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const [editName, setEditName] = useState('');
  const [editRoleIds, setEditRoleIds] = useState<number[]>([]);

  const assignableRoles = useMemo(
    () => roles.filter((role) => isTruthyFlag(role.isAssignable) && !isTruthyFlag(role.isComputed)),
    [roles]
  );

  const selected = accounts.find((account) => account.id === selectedId) ?? null;

  const loadAccounts = useCallback(async () => {
    const [accountsResponse, rolesResponse] = await Promise.all([
      api.get<{ serviceAccounts: ServiceAccount[] }>('/service-accounts'),
      api.get<AssignableRole[]>('/rbac/roles'),
    ]);
    setAccounts(accountsResponse.data.serviceAccounts);
    setRoles(Array.isArray(rolesResponse.data) ? rolesResponse.data : []);
  }, []);

  const loadTokens = useCallback(async (memberId: number) => {
    setTokensLoading(true);
    try {
      const response = await api.get<{ tokens: PersonalAccessTokenRow[] }>(
        `/service-accounts/${memberId}/tokens`
      );
      setTokens(response.data.tokens);
    } finally {
      setTokensLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadAccounts()
      .catch((error: unknown) => {
        if (!cancelled) showAlert(formatApiError(error, 'Unable to load service accounts.'), 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadAccounts, showAlert]);

  useEffect(() => {
    if (!selected) {
      setTokens([]);
      return;
    }
    setEditName(selected.name);
    setEditRoleIds(selected.roles.map((role) => role.id));
    void loadTokens(selected.id).catch((error: unknown) => {
      showAlert(formatApiError(error, 'Unable to load tokens.'), 'error');
    });
  }, [loadTokens, selected, showAlert]);

  const columns: Array<DataTableColumn<ServiceAccount>> = [
    {
      id: 'name',
      header: 'Name',
      renderCell: (account) => account.name,
    },
    {
      id: 'roles',
      header: 'Roles',
      renderCell: (account) =>
        account.roles.length > 0 ? account.roles.map((role) => role.name).join(', ') : 'None',
    },
    {
      id: 'tokens',
      header: 'Active tokens',
      renderCell: (account) => String(account.tokenCount),
    },
    {
      id: 'created',
      header: 'Created',
      renderCell: (account) => formatTimestamp(account.createdAt),
    },
  ];

  const tokenColumns: Array<DataTableColumn<PersonalAccessTokenRow>> = [
    { id: 'name', header: 'Name', renderCell: (token) => token.name },
    { id: 'prefix', header: 'Prefix', renderCell: (token) => token.tokenPrefix },
    { id: 'created', header: 'Created', renderCell: (token) => formatTimestamp(token.createdAt) },
    { id: 'used', header: 'Last used', renderCell: (token) => formatTimestamp(token.lastUsedAt) },
    { id: 'expires', header: 'Expires', renderCell: (token) => formatTimestamp(token.expiresAt) },
    {
      id: 'status',
      header: 'Status',
      renderCell: (token) => (token.revokedAt ? 'Revoked' : 'Active'),
    },
  ];

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await api.post('/service-accounts', {
        name: createName.trim(),
        roleIds: createRoleIds,
      });
      await loadAccounts();
      const created = response.data.serviceAccount as ServiceAccount | undefined;
      if (created) setSelectedId(created.id);
      setCreateOpen(false);
      setCreateName('');
      setCreateRoleIds([]);
      showAlert('Service account created.', 'success');
    } catch (error: unknown) {
      showAlert(formatApiError(error, 'Unable to create service account.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAccount = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    try {
      await api.patch(`/service-accounts/${selected.id}`, {
        name: editName.trim(),
        roleIds: editRoleIds,
      });
      await loadAccounts();
      showAlert('Service account updated.', 'success');
    } catch (error: unknown) {
      showAlert(formatApiError(error, 'Unable to update service account.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!selected) return;
    const ok = await confirm({
      title: 'Delete service account',
      message: `Delete ${selected.name}? This revokes all of its tokens.`,
      variant: 'danger',
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/service-accounts/${selected.id}`);
      setSelectedId(null);
      await loadAccounts();
      showAlert('Service account deleted.', 'success');
    } catch (error: unknown) {
      showAlert(formatApiError(error, 'Unable to delete service account.'), 'error');
    }
  };

  const handleMint = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    try {
      const response = await api.post(`/service-accounts/${selected.id}/tokens`, {
        name: mintName.trim(),
        expiresAt: dateTimeLocalToIsoOrNull(mintExpiry),
      });
      setCreatedToken(response.data.token as string);
      await loadAccounts();
      await loadTokens(selected.id);
      showAlert('Token created. Copy it now; it will not be shown again.', 'success');
    } catch (error: unknown) {
      showAlert(formatApiError(error, 'Unable to create token.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRevokeToken = async (token: PersonalAccessTokenRow) => {
    if (!selected || token.revokedAt) return;
    const ok = await confirm({
      title: 'Revoke token',
      message: `Revoke ${token.name} (${token.tokenPrefix}…)? API calls using this token will stop working.`,
      variant: 'danger',
      confirmText: 'Revoke',
    });
    if (!ok) return;
    try {
      await api.delete(`/service-accounts/${selected.id}/tokens/${token.id}`);
      await loadTokens(selected.id);
      await loadAccounts();
      showAlert('Token revoked.', 'success');
    } catch (error: unknown) {
      showAlert(formatApiError(error, 'Unable to revoke token.'), 'error');
    }
  };

  const copyToken = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken);
      showAlert('Token copied.', 'success');
    } catch {
      showAlert('Could not copy the token. Select it and copy it manually.', 'error');
    }
  };

  return (
    <AppPage>
      <AppPageHeader
        title="Service accounts"
        description="Machine logins for website helpers. Assign the same roles a person would use, then mint a personal access token."
        actions={
          <Button type="button" onClick={() => setCreateOpen(true)}>
            Add service account
          </Button>
        }
      />

      {loading ? (
        <AppStateCard title="Loading service accounts" />
      ) : accounts.length === 0 ? (
        <AppStateCard
          title="No service accounts yet"
          description="Create one for a bot or integration, then mint a token to sign in to the API or admin UI."
          action={
            <Button type="button" onClick={() => setCreateOpen(true)}>
              Add service account
            </Button>
          }
        />
      ) : (
        <div className="space-y-8">
          <DataTable
            rows={accounts}
            rowKey={(account) => account.id}
            columns={columns}
            getRowClassName={(account) =>
              account.id === selectedId ? 'bg-teal-50 dark:bg-teal-900/20' : undefined
            }
            actions={{
              header: 'Actions',
              renderActions: (account) => (
                <Button type="button" variant="secondary" onClick={() => setSelectedId(account.id)}>
                  Manage
                </Button>
              ),
            }}
          />

          {selected ? (
            <div className="app-card space-y-6 p-6">
              <form onSubmit={handleSaveAccount} className="space-y-4">
                <FormSection title="Account">
                  <FormField label="Name" htmlFor={editNameId} required>
                    <input
                      id={editNameId}
                      className="app-input"
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      required
                    />
                  </FormField>
                  <div>
                    <p id={editRoleLegendId} className="app-label mb-2">
                      Roles
                    </p>
                    <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
                      Typical choice: Content admin. Add Calendar admin only if the bot will edit the calendar.
                    </p>
                    <RoleChecklist
                      legendId={editRoleLegendId}
                      roles={assignableRoles}
                      selectedIds={editRoleIds}
                      onChange={setEditRoleIds}
                    />
                  </div>
                </FormSection>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </Button>
                  <Button type="button" variant="outline-danger" onClick={() => void handleDeleteAccount()}>
                    Delete
                  </Button>
                </div>
              </form>

              <FormSection title="Personal access tokens">
                <div className="mb-4">
                  <Button
                    type="button"
                    onClick={() => {
                      setCreatedToken(null);
                      setMintName('Website helper');
                      setMintExpiry('');
                      setMintOpen(true);
                    }}
                  >
                    Mint token
                  </Button>
                </div>
                {tokensLoading ? (
                  <AppStateCard compact title="Loading tokens" />
                ) : (
                  <DataTable
                    rows={tokens}
                    rowKey={(token) => token.id}
                    columns={tokenColumns}
                    emptyState={<AppStateCard compact title="No tokens yet" />}
                    actions={{
                      header: 'Actions',
                      renderActions: (token) =>
                        token.revokedAt ? null : (
                          <Button
                            type="button"
                            variant="outline-danger"
                            onClick={() => void handleRevokeToken(token)}
                          >
                            Revoke
                          </Button>
                        ),
                    }}
                  />
                )}
              </FormSection>
            </div>
          ) : null}
        </div>
      )}

      <Modal isOpen={createOpen} onClose={() => setCreateOpen(false)} title="Add service account">
        <form onSubmit={handleCreate} className="space-y-4">
          <FormField label="Name" htmlFor={nameFieldId} required>
            <input
              id={nameFieldId}
              className="app-input"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder="Website helper"
              required
            />
          </FormField>
          <div>
            <p id={roleLegendId} className="app-label mb-2">
              Roles
            </p>
            <RoleChecklist
              legendId={roleLegendId}
              roles={assignableRoles}
              selectedIds={createRoleIds}
              onChange={setCreateRoleIds}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !createName.trim()}>
              {saving ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={mintOpen}
        onClose={() => {
          setMintOpen(false);
          setCreatedToken(null);
        }}
        title="Mint access token"
      >
        {createdToken ? (
          <div className="space-y-4">
            <p className="text-sm font-medium">Personal access token (shown once)</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Copy this token before closing. Store it in the bot’s secret field, not in chat.
            </p>
            <textarea
              className="app-input font-mono text-sm"
              readOnly
              rows={4}
              value={createdToken}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => void copyToken()}>
                Copy token
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setMintOpen(false);
                  setCreatedToken(null);
                }}
              >
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleMint} className="space-y-4">
            <FormField label="Token name" htmlFor={tokenNameId} required>
              <input
                id={tokenNameId}
                className="app-input"
                value={mintName}
                onChange={(event) => setMintName(event.target.value)}
                required
              />
            </FormField>
            <FormField
              label="Expires"
              htmlFor={tokenExpiryId}
              optional
              helperText="Leave blank for a token that stays valid until you revoke it."
            >
              <input
                id={tokenExpiryId}
                type="datetime-local"
                className="app-input"
                value={mintExpiry}
                onChange={(event) => setMintExpiry(event.target.value)}
              />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setMintOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !mintName.trim()}>
                {saving ? 'Creating…' : 'Mint token'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </AppPage>
  );
}
